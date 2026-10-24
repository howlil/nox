import { ChildProcess, spawn } from "child_process";
import { StringDecoder } from "string_decoder";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { parseAgyUsage, parseAgyCredits, type QuotaReading } from "./QuotaProtocol";
import { runAgyQuotaCommands } from "./QuotaProcess";
import {
  AgentAdapter,
  AgentInput,
  AgentContext,
  AgentStreamEvent,
  AgentModel,
  AgentFailure,
  AgentHealth,
  AgentRuntimeConfig,
  SendOptions,
} from "../../packages/core/src/types";
import {
  AgyProtocolState,
  encodeAgyUserMessage,
  parseAgyLine,
} from "./AgyProtocol";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// AGY headless protocol used by this adapter:
//
//   agy --input-format stream-json --output-format stream-json
//       [--model <id>] [--conversation <id>]
//
// Prompts are written to stdin as one JSON user event per line. This keeps
// note/context payloads out of OS argv and avoids command-line size limits.
// Each send() still owns one process so cancellation and conversation
// persistence remain simple at the Nox boundary.

export interface AgyRuntimeDeps {
  spawn: typeof spawn;
  existsSync: typeof existsSync;
  homedir: typeof homedir;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  modelDiscoveryTimeoutMs: number;
}

const DEFAULT_RUNTIME_DEPS: AgyRuntimeDeps = {
  spawn,
  existsSync,
  homedir,
  platform: process.platform,
  env: process.env,
  modelDiscoveryTimeoutMs: 8_000,
};

export class AgyAdapter implements AgentAdapter {
  private readonly deps: AgyRuntimeDeps;
  private quotaProbeDisabled = false;

  constructor(
    private readonly cwd?: string,
    private readonly getConfig: () => AgentRuntimeConfig = () => ({}),
    deps: Partial<AgyRuntimeDeps> = {},
  ) {
    this.deps = {
      ...DEFAULT_RUNTIME_DEPS,
      ...deps,
    };
  }

  /** Quota-only CLI commands (AGY 1.2.15+). Never starts an inference turn. */
  async readQuota(signal?: AbortSignal): Promise<QuotaReading[]> {
    if (this.quotaProbeDisabled) {
      throw new Error("AGY quota probing disabled after an unexpected AI turn.");
    }
    try {
      const binary = await this.resolveBinary();
      const { usage, credits } = await runAgyQuotaCommands(binary, this.cwd, signal, this.deps.spawn);
      return [...parseAgyUsage(usage), ...parseAgyCredits(credits)];
    } catch (error) {
      if (error instanceof Error && /read-only.*command|triggered an AI turn/.test(error.message)) {
        this.quotaProbeDisabled = true;
      }
      throw error;
    }
  }

  async check(): Promise<AgentHealth> {
    try {
      await this.resolveBinary();
      return { status: "ready" };
    } catch (error) {
      const configured = this.getConfig().executablePath?.trim();
      return {
        status: configured ? "misconfigured" : "unavailable",
        failure: this.failureFrom(error, "runtime-unavailable"),
      };
    }
  }

  private async resolveBinary(): Promise<string> {
    const configured =
      this.getConfig().executablePath?.trim() ||
      this.deps.env.AGY_PATH?.trim();

    if (configured && !this.deps.existsSync(configured)) {
      throw new Error(
        `Configured agent executable does not exist: ${configured}`,
      );
    }

    const candidates = [
      configured,
      ...(this.deps.platform === "win32"
        ? [
            this.deps.env.LOCALAPPDATA
              ? join(this.deps.env.LOCALAPPDATA, "agy", "bin", "agy.exe")
              : undefined,
            this.deps.env.ProgramFiles
              ? join(
                  this.deps.env.ProgramFiles,
                  "Google",
                  "antigravity-cli",
                  "agy.exe",
                )
              : undefined,
          ]
        : [join(this.deps.homedir(), ".local", "bin", "agy")]),
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      if (this.deps.existsSync(candidate)) return candidate;
    }

    return new Promise((resolve, reject) => {
      const locator = this.deps.platform === "win32" ? "where" : "which";
      let child: ChildProcess;
      try {
        child = this.deps.spawn(locator, ["agy"], {
          windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        reject(new Error("AGY executable discovery could not start."));
        return;
      }
      let output = "";
      let receivedBytes = 0;
      let settled = false;
      const finish = (path?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!path) {
          child.kill();
          reject(new Error("AGY CLI not found. Install it or configure its executable path."));
        } else resolve(path);
      };
      const timer = setTimeout(() => finish(), 3_000);
      child.stdout?.on("data", (data: Buffer) => {
        receivedBytes += data.length;
        if (receivedBytes > 64 * 1024) { finish(); return; }
        output += data.toString("utf8");
      });
      child.stderr?.on("data", () => {}); // Discard private PATH diagnostics.
      child.on("error", () => finish());
      child.on("close", (code) => {
        const candidate = output.trim().split(/\r?\n/)[0];
        finish(code === 0 && candidate ? candidate : undefined);
      });
    });
  }

  async *send(
    input: AgentInput,
    opts: SendOptions,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    if (signal.aborted) {
      yield { type: "cancelled" };
      return;
    }

    let bin: string;
    try {
      bin = await this.resolveBinary();
    } catch (error) {
      yield {
        type: "failed",
        failure: this.failureFrom(error, "runtime-unavailable"),
      };
      return;
    }

    const proc = this.deps.spawn(bin, this.buildArgs(opts), {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const abort = () => {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill("SIGTERM");
      }
    };
    signal.addEventListener("abort", abort, { once: true });

    try {
      if (!proc.stdin) {
        yield {
          type: "failed",
          failure: this.failureFrom(
            "AGY stdin is unavailable.",
            "process-failed",
          ),
        };
        return;
      }

      const fullPrompt = this.buildFullPrompt(input);
      proc.stdin.end(encodeAgyUserMessage(fullPrompt));

      yield* this.readEvents(proc, signal);
    } finally {
      signal.removeEventListener("abort", abort);
      abort();
    }
  }

  private buildArgs(opts: SendOptions): string[] {
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ];

    if (opts.model) {
      args.push("--model", opts.model);
    }

    if (opts.conversationId) {
      args.push("--conversation", opts.conversationId);
    }

    return args;
  }

  private buildFullPrompt(input: AgentInput): string {
    const contextPreamble = this.formatContext(input.context);

    return contextPreamble
      ? `${contextPreamble}\n\n---\n\n${input.prompt}`
      : input.prompt;
  }

  private formatContext(ctx: AgentContext[]): string {
    if (ctx.length === 0) return "";

    return ctx
      .map((context, index) => {
        const type =
          context.type === "selection" ? "selection" : "note";
        const header =
          `<obsidian-context index="${index + 1}" type="${type}" file="${escapeAttribute(context.file)}">`;

        return (
          `${header}\n${context.content}\n</obsidian-context>`
        );
      })
      .join("\n\n");
  }

  private async *readEvents(
    proc: ChildProcess,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    let exitCode: number | null = null;
    const processState: {
      spawnError?: Error;
      inputError?: Error;
    } = {};
    let closed = false;
    let sawTerminalEvent = false;
    let protocolState: AgyProtocolState = {
      sawText: false,
    };

    const queue: string[] = [];
    let head = 0;
    let notify: (() => void) | null = null;

    const wake = () => {
      notify?.();
      notify = null;
    };

    const push = (line: string) => {
      queue.push(line);
      wake();
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (line) push(line);
      }
    });

    // Provider stderr may contain tokens, prompts or private local paths.
    // Drain it without retaining or echoing it to the Obsidian console.
    proc.stderr?.on("data", (_chunk: Buffer) => {});

    proc.stdin?.on("error", (error) => {
      processState.inputError = error;
      wake();
    });

    proc.on("error", (error) => {
      processState.spawnError = error;
      wake();
    });

    proc.on("close", (code) => {
      exitCode = code;
      buffer += decoder.end();
      const finalLine = buffer.trim();
      buffer = "";
      if (finalLine) queue.push(finalLine);
      closed = true;
      wake();
    });

    while (true) {
      if (signal.aborted) {
        yield { type: "cancelled" };
        break;
      }

      if (head < queue.length) {
        const line = queue[head++]!;
        // Array.shift() repeatedly moves queued events under large bursts.
        if (head >= 512 && head * 2 >= queue.length) {
          queue.splice(0, head);
          head = 0;
        }
        const parsed = parseAgyLine(line, protocolState);
        protocolState = parsed.state;

        for (const event of parsed.events) {
          yield event;

          if (
            event.type === "completed" ||
            event.type === "failed" ||
            event.type === "cancelled"
          ) {
            sawTerminalEvent = true;
          }
        }

        if (parsed.terminal) break;
        continue;
      }

      if (closed) {
        if (!sawTerminalEvent) {
          if (signal.aborted) {
            yield { type: "cancelled" };
            break;
          }

          const detail =
            processState.inputError?.message ||
            processState.spawnError?.message ||
            (exitCode !== 0
              ? `AGY exited with code ${exitCode ?? "unknown"} before returning a result.`
              : "AGY exited without returning a result.");

          yield {
            type: "failed",
            failure: this.failureFrom(detail, "process-failed"),
          };
        }
        break;
      }

      const processError =
        processState.inputError ?? processState.spawnError;

      if (processError) {
        yield {
          type: "failed",
          failure: this.failureFrom(
            processError,
            "process-failed",
          ),
        };
        break;
      }

      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }

  /** Catalog-only process. Errors never include untrusted stderr or model output. */
  async listModels(signal?: AbortSignal): Promise<AgentModel[]> {
    if (signal?.aborted) throw new Error("Model discovery cancelled.");
    const binary = await this.resolveBinary();
    if (signal?.aborted) throw new Error("Model discovery cancelled.");

    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.deps.spawn(binary, ["models"], {
          cwd: this.cwd, windowsHide: true, shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        reject(new Error("AGY model discovery could not start."));
        return;
      }
      let output = "";
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) {
          child.kill();
          reject(error);
          return;
        }
        // Parse only a bounded output produced by the selected executable.
        const models: AgentModel[] = output.split(/\r?\n/)
          .map(line => line.trim()).filter(Boolean)
          .map(line => line.split(/\t+|\s{2,}/).filter(Boolean))
          .filter(columns => columns.length >= 2)
          .map(columns => ({ id: columns[0].trim(), name: columns.slice(1).join(" ").trim() }));
        resolve(models);
      };
      const abort = () => finish(new Error("Model discovery cancelled."));
      const timer = setTimeout(() => finish(new Error("Model discovery timed out.")), this.deps.modelDiscoveryTimeoutMs);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          finish(new Error("Model catalog exceeded the response limit."));
          return;
        }
        output += chunk.toString("utf8");
      });
      // CLI diagnostics can contain private paths, account data or credentials.
      child.stderr?.on("data", () => {});
      child.on("error", () => finish(new Error("AGY model discovery process failed.")));
      child.on("close", code => finish(code === 0
        ? undefined : new Error("AGY could not list models. Check the local CLI.")));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  private failureFrom(
    error: unknown,
    code: AgentFailure["code"],
  ): AgentFailure {
    const diagnostic =
      error instanceof Error ? error.message : String(error);

    const message =
      code === "runtime-unavailable"
        ? "Agent runtime is unavailable. Configure its executable path and try again."
        : code === "permission-required"
          ? "The agent runtime requires approval before it can continue."
          : code === "protocol-invalid"
            ? "The agent runtime returned an invalid response."
            : "The agent runtime could not complete the request.";

    return { code, message, diagnostic };
  }
}
