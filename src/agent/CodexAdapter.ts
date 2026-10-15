import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { StringDecoder } from "string_decoder";
import type { QuotaReading } from "./QuotaProtocol";
import { runCodexQuotaRead } from "./QuotaProcess";
import type { AgentAdapter, AgentHealth, AgentInput, AgentModel, AgentRuntimeConfig, AgentStreamEvent, SendOptions } from "../types";
import { codexFailure, encodeCodexInput, isCodexThreadId, parseCodexLine, parseCodexModelPage, type CodexProtocolState } from "./CodexProtocol";

export interface CodexRuntimeDeps {
  spawn: typeof spawn;
  existsSync: typeof existsSync;
  platform: NodeJS.Platform;
  arch: string;
  env: NodeJS.ProcessEnv;
  kill: typeof process.kill;
  modelDiscoveryTimeoutMs: number;
}

/** One owned CLI process per turn; protocol details never cross AgentAdapter. */
export class CodexAdapter implements AgentAdapter {
  private readonly deps: CodexRuntimeDeps;
  private readonly stopping = new WeakSet<ChildProcess>();

  constructor(private readonly cwd?: string,
    private readonly getConfig: () => AgentRuntimeConfig = () => ({}),
    deps: Partial<CodexRuntimeDeps> = {}) {
    this.deps = { spawn, existsSync, platform: process.platform, arch: process.arch,
      env: process.env, kill: process.kill, modelDiscoveryTimeoutMs: 10000, ...deps };
  }

  /** A read-only app-server session: account/rateLimits/read, no new thread. */
  async readQuota(signal?: AbortSignal): Promise<QuotaReading[]> {
    const binary = await this.resolveBinary();
    return runCodexQuotaRead(binary, this.cwd, signal, this.deps.spawn);
  }

  async check(): Promise<AgentHealth> {
    try {
      const bin = await this.resolveBinary();
      await this.probe(bin, ["--version"]);
      await this.probe(bin, ["login", "status"]);
      return { status: "ready" };
    } catch (error) {
      return { status: this.getConfig().executablePath?.trim() ? "misconfigured" : "unavailable",
        failure: codexFailure("Codex is unavailable or signed out. Run codex login locally. " + String(error instanceof Error ? error.message : error), "runtime-unavailable") };
    }
  }

  /** Short-lived catalog-only connection: never create a thread or inference turn. */
  async listModels(signal?: AbortSignal): Promise<AgentModel[]> {
    if (signal?.aborted) throw new Error("Model discovery was cancelled.");
    const binary = await this.resolveBinary();
    if (signal?.aborted) throw new Error("Model discovery was cancelled.");
    const child = this.deps.spawn(binary,
      ["app-server", "--listen", "stdio://", "--config", 'model_provider="openai"'], {
        windowsHide: true, detached: this.deps.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
      });
    return new Promise<AgentModel[]>((resolve, reject) => {
      const decoder = new StringDecoder("utf8");
      const models = new Map<string, AgentModel>();
      const cursors = new Set<string>();
      let buffer = "", receivedBytes = 0, requestId = 0, settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        child.stdout?.removeListener("data", data);
        // Keep error handlers while the owned process shuts down (including EPIPE).
        child.stdin?.end();
        this.stopProcess(child);
        if (error) reject(error); else resolve([...models.values()]);
      };
      const fail = (error: Error) => finish(error);
      const abort = () => finish(new Error("Model discovery was cancelled."));
      const write = (message: object) => {
        try {
          if (!child.stdin) throw new Error("Model discovery input is unavailable.");
          child.stdin.write(JSON.stringify(message) + "\n");
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      };
      const list = (cursor?: string) => {
        write({ id: ++requestId, method: "model/list", params: { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) } });
      };
      const data = (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > 1024 * 1024) { fail(new Error("Model catalog exceeded the response limit.")); return; }
        buffer += decoder.write(chunk);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (settled) break;
          if (!line.trim()) continue;
          try {
            const value: unknown = JSON.parse(line);
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid model discovery response.");
            const response = value as Record<string, unknown>;
            if (response.id !== requestId) continue; // Unrelated server notifications.
            if ("error" in response) throw new Error("The runtime rejected model discovery.");
            if (requestId === 0) {
              if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) {
                throw new Error("Invalid model discovery initialization.");
              }
              write({ method: "initialized", params: {} });
              list();
            } else {
              const page = parseCodexModelPage(response.result);
              for (const model of page.models) if (!models.has(model.id)) models.set(model.id, model);
              if (page.nextCursor === null) finish();
              else {
                if (cursors.has(page.nextCursor) || cursors.size >= 20) throw new Error("Invalid model catalog pagination cursor.");
                cursors.add(page.nextCursor);
                list(page.nextCursor);
              }
            }
          } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
        }
      };
      const timer = setTimeout(() => fail(new Error("Model discovery timed out.")), this.deps.modelDiscoveryTimeoutMs);
      child.stdout?.on("data", data);
      child.stderr?.resume();
      child.on("error", fail);
      child.stdin?.on("error", fail);
      child.on("close", () => fail(new Error("Agent exited before model discovery completed.")));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      write({ id: 0, method: "initialize", params: {
        clientInfo: { name: "nox", title: "Nox", version: "0.0.1" }, capabilities: null,
      } });
    });
  }

  private async resolveBinary(): Promise<string> {
    const configured = this.getConfig().executablePath?.trim() || this.deps.env.CODEX_PATH?.trim();
    if (configured) {
      if (!this.deps.existsSync(configured)) throw new Error(`Configured agent executable does not exist: ${configured}`);
      return this.nativeExecutable(configured);
    }
    const bundled = this.deps.platform === "win32" && this.deps.env.LOCALAPPDATA
      ? join(this.deps.env.LOCALAPPDATA, "agy", "bin", "codex.exe") : undefined;
    if (bundled && this.deps.existsSync(bundled)) return bundled;
    const locations = await this.probe(this.deps.platform === "win32" ? "where.exe" : "which", ["codex"]);
    for (const location of locations.trim().split(/\r?\n/)) {
      if (!this.deps.existsSync(location)) continue;
      try { return this.nativeExecutable(location); } catch { /* Try the next PATH candidate. */ }
    }
    throw new Error("Codex CLI was not found. Install it or set an absolute executable path.");
  }

  private nativeExecutable(filename: string): string {
    if (this.deps.platform !== "win32" || !/\.(cmd|bat|ps1)$/i.test(filename)) return filename;
    // npm shims are scripts: find their native binary rather than invoking a shell.
    const triple = this.deps.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    const optional = this.deps.arch === "arm64" ? "codex-win32-arm64" : "codex-win32-x64";
    const base = join(dirname(filename), "node_modules", "@openai");
    const candidates = [
      join(base, "codex", "vendor", triple, "codex", "codex.exe"),
      join(base, optional, "vendor", triple, "codex", "codex.exe"),
      join(base, "codex", "node_modules", "@openai", optional, "vendor", triple, "codex", "codex.exe"),
    ];
    const native = candidates.find((candidate) => this.deps.existsSync(candidate));
    if (!native) throw new Error("Set the native codex.exe path; this CLI script shim could not be resolved.");
    return native;
  }

  private probe(binary: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.deps.spawn(binary, args, {
          windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        reject(new Error("Codex executable check could not start."));
        return;
      }
      let output = "";
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) { child.kill(); reject(error); }
        else resolve(output);
      };
      const timer = setTimeout(
        () => finish(new Error("Agent executable discovery timed out.")), 3_000,
      );
      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > 64 * 1024) {
          finish(new Error("Codex executable output exceeded the response limit."));
          return;
        }
        output += chunk.toString("utf8");
      });
      // Never show CLI stderr in a plugin error or notice.
      child.stderr?.on("data", () => {});
      child.on("error", () => finish(new Error("Codex executable check failed.")));
      child.on("close", code => finish(code === 0
        ? undefined : new Error("Codex executable check exited unsuccessfully.")));
    });
  }

  async *send(input: AgentInput, opts: SendOptions, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    if (signal.aborted) { yield { type: "cancelled" }; return; }
    if (opts.conversationId && !isCodexThreadId(opts.conversationId)) {
      yield { type: "failed", failure: codexFailure("Invalid stored thread identity. Start a new conversation.", "protocol-invalid") };
      return;
    }
    let binary: string;
    try { binary = await this.resolveBinary(); } catch (error) {
      yield { type: "failed", failure: codexFailure(String(error), "runtime-unavailable") };
      return;
    }
    if (signal.aborted) { yield { type: "cancelled" }; return; }
    const args = ["exec", "--sandbox", "read-only", "--config", 'approval_policy="never"',
      "--ignore-user-config", "--json", "--skip-git-repo-check", "--color", "never"];
    if (opts.model) args.push("--model", opts.model);
    if (opts.conversationId) args.push("resume", opts.conversationId);
    args.push("-");
    let child: ChildProcess;
    try {
      child = this.deps.spawn(binary, args, { cwd: this.cwd, windowsHide: true,
        detached: this.deps.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      yield { type: "failed", failure: codexFailure(String(error)) };
      return;
    }
    const stop = () => this.stopProcess(child);
    signal.addEventListener("abort", stop, { once: true });
    try { yield* this.readEvents(child, signal, encodeCodexInput(input), opts.conversationId); }
    catch (error) {
      if (signal.aborted) yield { type: "cancelled" };
      else yield { type: "failed", failure: codexFailure(String(error)) };
    }
    finally { signal.removeEventListener("abort", stop); stop(); }
  }

  private stopProcess(child: ChildProcess): void {
    if (child.exitCode !== null || child.killed || this.stopping.has(child)) return;
    this.stopping.add(child);
    if (!child.pid) { child.kill(); return; }
    if (this.deps.platform === "win32") {
      try {
        const killer = this.deps.spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => { child.kill(); });
        killer.on("close", (code) => { if (code !== 0) child.kill(); });
      } catch { child.kill(); }
    } else {
      try { this.deps.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    }
  }

  private async *readEvents(child: ChildProcess, signal: AbortSignal, input: string,
    conversationId?: string): AsyncIterable<AgentStreamEvent> {
    const state: CodexProtocolState = { conversationId, messages: new Map(), completed: false };
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let closed = false;
    let exitCode: number | null = null;
    let error: Error | undefined;
    const lines: string[] = [];
    let head = 0;
    let notify: (() => void) | undefined;
    const wake = () => { notify?.(); notify = undefined; };
    const data = (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      lines.push(...parts.filter((line) => line.trim()));
      wake();
    };
    // CLI diagnostics are untrusted and may expose local credentials.
    const diagnostic = (_chunk: Buffer) => {};
    const failed = (cause: Error) => { error = cause; wake(); };
    const close = (code: number | null) => {
      buffer += decoder.end();
      if (buffer.trim()) lines.push(buffer);
      closed = true; exitCode = code; wake();
    };
    child.stdout?.on("data", data);
    child.stderr?.on("data", diagnostic);
    child.on("error", failed);
    child.on("close", close);
    child.stdin?.on("error", failed);
    signal.addEventListener("abort", wake, { once: true });
    try {
      if (!child.stdin) throw new Error("Agent input is unavailable.");
      child.stdin.end(input);
      while (true) {
        if (signal.aborted) { yield { type: "cancelled" }; return; }
        if (error) { yield { type: "failed", failure: codexFailure(error.message) }; return; }
        if (head < lines.length) {
          const line = lines[head++]!;
          if (head >= 512 && head * 2 >= lines.length) {
            lines.splice(0, head);
            head = 0;
          }
          const events = parseCodexLine(line, state);
          if (state.failure) { yield { type: "failed", failure: state.failure }; return; }
          yield* events;
          continue;
        }
        if (closed) {
          if (exitCode !== 0) yield { type: "failed", failure: codexFailure(`Agent exited with code ${exitCode}. Check local Codex logs.`) };
          else if (!state.completed) yield { type: "failed", failure: codexFailure("Agent exited without completing the turn. Check local Codex logs.", "protocol-invalid") };
          else yield { type: "completed", conversationId: state.conversationId };
          return;
        }
        await new Promise<void>((resolve) => { notify = resolve; });
      }
    } finally {
      signal.removeEventListener("abort", wake);
      child.stdout?.removeListener("data", data);
      child.stderr?.removeListener("data", diagnostic);
      child.removeListener("error", failed);
      child.removeListener("close", close);
      // stdin can still emit EPIPE while the owned process is being terminated.
    }
  }
}
