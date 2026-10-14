
import { StringDecoder } from "string_decoder";
import {
  parseCodexRateLimits, type QuotaReading,
} from "./QuotaProtocol";

// Process creation belongs to concrete AgyAdapter/CodexAdapter. This module
// only owns protocol orchestration over an injected spawned-process handle.
type QuotaChild = {
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: string, callback: (...args: never[]) => void): unknown;
  kill(): boolean;
};
export type QuotaSpawn = (
  binary: string, args: string[],
  options: { cwd?: string; windowsHide?: boolean; stdio: ["ignore", "pipe", "pipe"] | ["pipe", "pipe", "pipe"] },
) => QuotaChild;
const MAX_BYTES = 256 * 1024;
const safeError = (message: string) => new Error(message);

function runReadOnlyCommand(binary: string, argv: string[], cwd: string | undefined,
  signal: AbortSignal | undefined, spawnFn: QuotaSpawn, timeoutMs = 14000): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: QuotaChild;
    try {
      child = spawnFn(binary, argv, { cwd, windowsHide: true, stdio: ["ignore","pipe","pipe"] });
    } catch {
      reject(safeError("Quota CLI could not be started."));return;
    }
    let stdout = "", length = 0, done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true; clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (err) { child.kill(); reject(err); }
      else resolve(stdout);
    };
    const abort = () => finish(safeError("Quota refresh was cancelled."));
    const timer = setTimeout(() => finish(safeError("Quota CLI timed out.")), timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_BYTES) { finish(safeError("Quota CLI output exceeded safety limit.")); return; }
      stdout += chunk.toString("utf8");
    });
    // Never collect stderr: OAuth diagnostics can contain account identifiers.
    child.stderr?.resume();
    child.on("error", () => finish(safeError("Quota CLI process failed.")));
    child.on("close", code => {
      if (code !== 0) finish(safeError("Quota CLI exited without a supported response."));
      else finish();
    });
    signal?.addEventListener("abort", abort, { once:true });
    if (signal?.aborted) abort();
  });
}

/** Verify AGY is new enough for no-inference /usage and /credits print mode. */
export async function runAgyQuotaCommands(binary: string, cwd: string | undefined,
  signal: AbortSignal | undefined, spawnFn: QuotaSpawn): Promise<{usage: unknown; credits: unknown | null}> {
  const version = await runReadOnlyCommand(binary, ["--version"], cwd, signal, spawnFn, 6000);
  const m = version.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!m) throw new Error("AGY CLI version is unknown; quota probing disabled for safety.");
  const [major, minor, patch] = m.slice(1).map(Number);
  if (major < 1 || (major === 1 && (minor < 2 || minor === 2 && patch < 15))) {
    throw new Error("Update AGY CLI to 1.2.15+ for read-only quota sync.");
  }
  // Do not pass --disable-slash-commands; that would turn /usage into an AI turn.
  const usageText = await runReadOnlyCommand(binary,
    ["--output-format","json","-p","/usage"],cwd,signal,spawnFn,18000);
  let usage: unknown;
  try { usage = JSON.parse(usageText); }
  catch { throw new Error("AGY /usage did not return structured JSON."); }
  // Validate framing BEFORE proceeding to /credits. A model turn may spend tokens.
  const root = usage && typeof usage === "object" && !Array.isArray(usage)
    ? usage as Record<string,unknown> : null;
  const command = root?.command && typeof root.command === "object"
    ? root.command as Record<string,unknown> : null;
  if (!root || root.status !== "SUCCESS" || command?.name !== "usage" ||
      root.num_turns !== 0 || (typeof root.conversation_id === "string" && root.conversation_id !== "")) {
    throw new Error("AGY did not confirm a read-only /usage command. Quota probing stopped.");
  }
  // Optional credits command: supported in the same AGY versions.
  let credits: unknown | null = null;
  try {
    const data = await runReadOnlyCommand(binary,
      ["--output-format","json","-p","/credits"],cwd,signal,spawnFn,14000);
    credits = JSON.parse(data) as unknown;
  } catch { /* Independent credits may be unsupported on this account. */ }
  return { usage, credits };
}

/** Read-only JSON-RPC app-server session. Does not create a thread or inference turn. */
export async function runCodexQuotaRead(binary: string, cwd: string | undefined,
  signal: AbortSignal | undefined, spawnFn: QuotaSpawn): Promise<QuotaReading[]> {
  return new Promise((resolve,reject) => {
    let child: QuotaChild;
    try {
      child = spawnFn(binary, ["app-server","--listen","stdio://"], {
        cwd, windowsHide: true, stdio: ["pipe","pipe","pipe"],
      });
    } catch {
      reject(safeError("Could not start Codex app-server.")); return;
    }
    const decoder = new StringDecoder("utf8");
    let buffer = "", byteCount = 0, done = false, initialized = false;
    const finish = (error?: Error, result?: QuotaReading[]) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener("abort",abort);
      child.stdin?.end();child.kill();
      if (error) reject(error); else resolve(result || []);
    };
    const abort = () => finish(safeError("Codex quota refresh was cancelled."));
    const timer = setTimeout(() => finish(safeError("Codex quota read timed out.")),12000);
    const write = (value: object) => {
      try { child.stdin?.write(JSON.stringify(value)+"\n"); }
      catch { finish(safeError("Codex quota request could not be sent.")); }
    };
    child.stdout?.on("data",(chunk:Buffer)=>{
      if (done) return;
      byteCount += chunk.length;
      if (byteCount > MAX_BYTES) { finish(safeError("Codex quota response exceeded safety limit."));return; }
      buffer += decoder.write(chunk);
      const lines = buffer.split(/\r?\n/);buffer = lines.pop() || "";
      for (const line of lines) {
        if (done || !line.trim()) continue;
        let raw: unknown;
        try { raw = JSON.parse(line); }
        catch { finish(safeError("Invalid Codex JSON-RPC response."));return; }
        const response = raw && typeof raw === "object" && !Array.isArray(raw)
          ? raw as Record<string,unknown> : null;
        if (!response || (response.id !== 1 && response.id !== 2)) continue;
        if ("error" in response) { finish(safeError("Codex rejected the quota request."));return; }
        if (response.id === 1 && !initialized) {
          if (!response.result || typeof response.result !== "object") {
            finish(safeError("Invalid Codex app-server handshake."));return;
          }
          initialized = true;
          write({ method:"initialized",params:{} });
          write({ id:2, method:"account/rateLimits/read",params:null });
        } else if (response.id === 2 && initialized) {
          try { finish(undefined,parseCodexRateLimits(response.result)); }
          catch { finish(safeError("Codex did not return supported quota fields.")); }
        }
      }
    });
    child.stderr?.resume();
    child.on("error",()=>finish(safeError("Codex quota process failed.")));
    child.stdin?.on("error",()=>finish(safeError("Codex quota pipe failed.")));
    child.on("close",()=>finish(safeError("Codex exited before returning quotas.")));
    signal?.addEventListener("abort",abort,{once:true});
    if (signal?.aborted) {abort();return;}
    write({ id:1,method:"initialize",params:{
      clientInfo:{name:"nox",title:"Nox",version:"0.0.1"},capabilities:null,
    }});
  });
}
