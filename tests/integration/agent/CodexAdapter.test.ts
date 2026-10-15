import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import { CodexAdapter } from "../../../src/agent/CodexAdapter";
import { collectEvents } from "../../support/collect-events";

const thread = "0199a213-81c0-7800-8aa1-bbab2a035a53";
const payload = [{ type: "thread.started", thread_id: thread },
  { type: "item.completed", item: { type: "agent_message", id: "answer", text: "日本語 answer" } },
  { type: "turn.completed", usage: {} }].map((event) => JSON.stringify(event)).join("\n");

class FakeChild extends EventEmitter {
  stdout = new EventEmitter(); stderr = Object.assign(new EventEmitter(), { resume: () => {} });
  writes: string[] = [];
  stdin = Object.assign(new EventEmitter(), { end: (text: string) => { this.writes.push(text); } });
  exitCode: number | null = null;
  killed = false;
  pid?: number;
  kill() { this.killed = true; return true; }
}

function adapter(spawner: (command: string, args: readonly string[], options?: unknown) => FakeChild) {
  return new CodexAdapter(undefined, () => ({ executablePath: "/bin/codex" }), {
    spawn: spawner as never, existsSync: () => true, platform: "linux", env: {},
  });
}

test("stdin contains user data; argv locks sandbox and resumes only the requested thread", async () => {
  let captured!: { args: readonly string[]; child: FakeChild; options: { shell?: boolean } };
  const runtime = adapter((_command, args, options) => {
    const child = new FakeChild();
    captured = { args, child, options: options as { shell?: boolean } };
    queueMicrotask(() => {
      const bytes = Buffer.from(payload);
      for (let i = 0; i < bytes.length; i++) child.stdout.emit("data", bytes.subarray(i, i + 1));
      child.exitCode = 0; child.emit("close", 0);
    });
    return child;
  });
  const events = await collectEvents(runtime.send({ prompt: 'SECRET\n$(danger)&"', context: [] },
    { conversationId: thread, model: "chosen-model" }, new AbortController().signal));
  assert.ok(captured.child.writes.join("").includes('SECRET\n$(danger)&"'));
  assert.ok(!captured.args.some((arg) => arg.includes("SECRET")));
  assert.ok(captured.args.includes("read-only"));
  assert.ok(captured.args.includes('approval_policy="never"'));
  assert.ok(captured.args.includes("--ignore-user-config"));
  assert.deepEqual(captured.args.slice(-3), ["resume", thread, "-"]);
  assert.ok(captured.args.includes("chosen-model"));
  assert.ok(!captured.options.shell);
  assert.deepEqual(events, [{ type: "text", content: "日本語 answer" }, { type: "completed", conversationId: thread }]);
});

for (const [name, text, code] of [
  ["nonzero exit after success", payload, 1],
  ["missing terminal", payload.split("\n").slice(0, -1).join("\n"), 0],
  ["malformed output", "not-json", 0],
  ["failed turn", JSON.stringify({ type: "turn.failed", error: { message: "quota exhausted" } }), 0],
] as const) {
  test(`${name} never emits completed`, async () => {
    const runtime = adapter(() => {
      const child = new FakeChild();
      queueMicrotask(() => { child.stdout.emit("data", Buffer.from(text)); child.exitCode = code; child.emit("close", code); });
      return child;
    });
    const events = await collectEvents(runtime.send({ prompt: "x", context: [] }, {}, new AbortController().signal));
    assert.equal(events.at(-1)?.type, "failed");
    assert.ok(!events.some((event) => event.type === "completed"));
  });
}

test("pre-abort and invalid stored thread ids never spawn a CLI", async () => {
  let calls = 0;
  const runtime = adapter(() => { calls++; return new FakeChild(); });
  const cancelled = new AbortController(); cancelled.abort();
  assert.deepEqual(await collectEvents(runtime.send({ prompt: "x", context: [] }, {}, cancelled.signal)), [{ type: "cancelled" }]);
  const invalid = await collectEvents(runtime.send({ prompt: "x", context: [] }, { conversationId: "--last" }, new AbortController().signal));
  assert.equal(invalid.at(-1)?.type, "failed");
  assert.equal(calls, 0);
});

test("abort wakes a silent process without waiting for a close event", async () => {
  const controller = new AbortController();
  let child!: FakeChild;
  const runtime = adapter(() => { child = new FakeChild(); queueMicrotask(() => controller.abort()); return child; });
  const events = await collectEvents(runtime.send({ prompt: "x", context: [] }, {}, controller.signal));
  assert.deepEqual(events, [{ type: "cancelled" }]);
  assert.equal(child.killed, true);
});

test("Windows cancellation terminates the owned process tree once with hidden taskkill", async () => {
  const controller = new AbortController();
  const commands: Array<{ command: string; args: readonly string[]; options: unknown }> = [];
  const runtime = new CodexAdapter(undefined, () => ({ executablePath: "C:/codex.exe" }), {
    existsSync: () => true, platform: "win32", env: {}, spawn: ((command, args, options) => {
      commands.push({ command, args, options });
      const child = new FakeChild();
      if (command !== "taskkill.exe") { child.pid = 42; queueMicrotask(() => controller.abort()); }
      else queueMicrotask(() => child.emit("close", 0));
      return child;
    }) as never,
  });
  const events = await collectEvents(runtime.send({ prompt: "x", context: [] }, {}, controller.signal));
  assert.equal(events.at(-1)?.type, "cancelled");
  const kills = commands.filter((call) => call.command === "taskkill.exe");
  assert.equal(kills.length, 1);
  assert.deepEqual(kills[0].args, ["/pid", "42", "/T", "/F"]);
  assert.equal((kills[0].options as { windowsHide: boolean }).windowsHide, true);
});

test("configured missing CLI is recoverable and model discovery does not run inference", async () => {
  let calls = 0;
  const runtime = new CodexAdapter(undefined, () => ({ executablePath: "/missing/codex" }), {
    existsSync: () => false, spawn: (() => { calls++; return new FakeChild(); }) as never,
  });
  assert.equal((await runtime.check()).status, "misconfigured");
  await assert.rejects(runtime.listModels(), /does not exist/);
  assert.equal(calls, 0);
});

function catalogRuntime(reply: (request: Record<string, any>, child: FakeChild) => void, timeoutMs = 1000) {
  let owned!: FakeChild;
  const requests: Array<Record<string, any>> = [];
  let args: readonly string[] = [];
  const runtime = new CodexAdapter("/vault", () => ({ executablePath: "/bin/codex" }), {
    platform: "linux", env: {}, existsSync: () => true, modelDiscoveryTimeoutMs: timeoutMs,
    spawn: ((_command, argv, options) => {
      assert.ok(!(options as { shell?: boolean }).shell);
      args = argv;
      owned = new FakeChild();
      Object.assign(owned.stdin, { write: (line: string) => {
        const request = JSON.parse(line);
        requests.push(request);
        queueMicrotask(() => reply(request, owned));
        return true;
      } });
      return owned;
    }) as never,
  });
  return { runtime, requests, child: () => owned, args: () => args };
}

function rpcReply(child: FakeChild, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  for (let i = 0; i < bytes.length; i++) child.stdout.emit("data", bytes.subarray(i, i + 1));
}

test("model discovery initializes app-server, pages visible models, and closes without starting inference", async () => {
  const r = catalogRuntime((request, child) => {
    if (request.method === "initialize") rpcReply(child, { id: request.id, result: {} });
    if (request.method === "model/list") {
      rpcReply(child, { method: "account/updated", params: {} });
      rpcReply(child, { id: request.id, result: request.params.cursor ? {
        data: [{ id: "catalog-row", model: "second-model", displayName: "日本語 model", hidden: false }], nextCursor: null,
      } : {
        data: [{ id: "internal-row", model: "first-model", displayName: "First model", hidden: false },
          { id: "hidden-row", model: "hidden-model", displayName: "Hidden", hidden: true }], nextCursor: "next-page",
      } });
    }
  });
  assert.deepEqual(await r.runtime.listModels(), [{ id: "first-model", name: "First model" }, { id: "second-model", name: "日本語 model" }]);
  assert.ok(r.args().includes("app-server"));
  assert.ok(r.args().includes("stdio://"));
  assert.deepEqual(r.requests.map((request) => request.method), ["initialize", "initialized", "model/list", "model/list"]);
  assert.equal(r.requests[2].params.includeHidden, false);
  assert.equal(r.requests[3].params.cursor, "next-page");
  assert.equal(r.child().killed, true);
});

for (const [name, result] of Object.entries({
  malformed: { data: "wrong", nextCursor: null },
  invalidModel: { data: [{ model: 42, displayName: "Bad" }], nextCursor: null },
  invalidCursor: { data: [], nextCursor: 42 },
})) {
  test(`model discovery rejects ${name} catalog without keeping partial choices`, async () => {
    const r = catalogRuntime((request, child) => {
      if (request.method === "initialize") rpcReply(child, { id: request.id, result: {} });
      if (request.method === "model/list") rpcReply(child, { id: request.id, result });
    });
    await assert.rejects(r.runtime.listModels(), /model|catalog|cursor/i);
    assert.equal(r.child().killed, true);
  });
}

test("model discovery reports RPC errors, premature exit, and malformed JSON", async () => {
  for (const failure of ["rpc", "exit", "json"]) {
    const r = catalogRuntime((request, child) => {
      if (failure === "rpc") rpcReply(child, { id: request.id, error: { code: -32601, message: "not supported" } });
      if (failure === "exit") { child.exitCode = 1; child.emit("close", 1); }
      if (failure === "json") child.stdout.emit("data", Buffer.from("invalid json\n"));
    });
    await assert.rejects(r.runtime.listModels());
    assert.ok(r.child().killed || r.child().exitCode !== null);
  }
});

test("model discovery times out or aborts a silent process and releases it", async () => {
  const silent = catalogRuntime(() => {}, 15);
  await assert.rejects(silent.runtime.listModels(), /timed out/i);
  assert.equal(silent.child().killed, true);
  const r = catalogRuntime(() => {});
  const controller = new AbortController();
  const pending = r.runtime.listModels(controller.signal);
  // The first request is sent after executable resolution.
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, /cancelled/i);
  assert.equal(r.child().killed, true);
});

test("repeating pagination cursor is rejected instead of leaving a discovery process running", async () => {
  const r = catalogRuntime((request, child) => {
    if (request.method === "initialize") rpcReply(child, { id: request.id, result: {} });
    if (request.method === "model/list") rpcReply(child, { id: request.id, result: { data: [], nextCursor: "same" } });
  });
  await assert.rejects(r.runtime.listModels(), /cursor/i);
  assert.equal(r.child().killed, true);
});

test("catalog discovery reads a real JSONL subprocess and releases it after the response", { timeout: 5000 }, async (t) => {
  let closed!: Promise<void>;
  let owned: ReturnType<typeof spawn> | undefined;
  t.after(() => { if (owned?.exitCode === null) owned.kill(); });
  const fixture = "require('readline').createInterface({input:process.stdin}).on('line',line=>{" +
    "const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));" +
    "if(r.method==='model/list')console.log(JSON.stringify({id:r.id,result:{data:[{id:'row',model:'fixture-model',displayName:'Fixture model',hidden:false}],nextCursor:null}}));});";
  const runtime = new CodexAdapter(undefined, () => ({ executablePath: process.execPath }), {
    spawn: ((command, args, options) => {
      if (command === "taskkill.exe") return spawn(command, args, options);
      const child = spawn(process.execPath, ["-e", fixture], options);
      closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      owned = child;
      return child;
    }) as typeof spawn,
  });
  assert.deepEqual(await runtime.listModels(), [{ id: "fixture-model", name: "Fixture model" }]);
  await closed;
});

test("real owned subprocess exits are observed before success is published", { timeout: 5000 }, async () => {
  const runtime = new CodexAdapter(undefined, () => ({ executablePath: process.execPath }), {
    spawn: ((_command, _args, options) => spawn(process.execPath, ["-e",
      "process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(" + JSON.stringify(payload) + ");process.exitCode=3;});"], options)) as typeof spawn,
  });
  const events = await collectEvents(runtime.send({ prompt: "x", context: [] }, {}, new AbortController().signal));
  assert.ok(events.some((event) => event.type === "text"));
  assert.equal(events.at(-1)?.type, "failed");
});

test("real process cancellation releases the CLI process", { timeout: 5000 }, async (t) => {
  let closed!: Promise<void>;
  let owned: ReturnType<typeof spawn> | undefined;
  t.after(() => { if (owned?.exitCode === null) owned.kill(); });
  const runtime = new CodexAdapter(undefined, () => ({ executablePath: process.execPath }), {
    spawn: ((command, args, options) => {
      if (command === "taskkill.exe") return spawn(command, args, options);
      const child = spawn(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(" +
        JSON.stringify(payload.split("\n").slice(0, -1).join("\n") + "\n") + ");setInterval(()=>{},1000);});"], options);
      closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      owned = child;
      return child;
    }) as typeof spawn,
  });
  const controller = new AbortController();
  const stream = runtime.send({ prompt: "x", context: [] }, {}, controller.signal)[Symbol.asyncIterator]();
  assert.equal((await stream.next()).value.type, "text");
  controller.abort();
  assert.equal((await stream.next()).value.type, "cancelled");
  await stream.return?.();
  await closed;
});

test("Codex diagnostic stderr never appears in user-visible failures", async () => {
  const secret = "Bearer TOP-SECRET-REFRESH-TOKEN";
  const runtime = adapter(() => {
    const child = new FakeChild();
    queueMicrotask(() => {
      child.stderr.emit("data", Buffer.from(secret));
      child.exitCode = 1;
      child.emit("close", 1);
    });
    return child;
  });
  const events = await collectEvents(runtime.send(
    { prompt: "safe prompt", context: [] }, {}, new AbortController().signal));
  assert.equal(events.at(-1)?.type, "failed");
  assert.doesNotMatch(JSON.stringify(events), /TOP-SECRET-REFRESH-TOKEN/);
});

test("Codex health probe rejects oversized stdout and never exposes stderr", async () => {
  const probe = new FakeChild();
  const runtime = adapter((_command, args) => {
    assert.deepEqual(args, ["--version"]);
    queueMicrotask(() => {
      probe.stderr.emit("data", Buffer.from("SECRET_FAKE_CREDENTIAL"));
      probe.stdout.emit("data", Buffer.alloc(65 * 1024, 65));
    });
    return probe;
  });
  const health = await runtime.check();
  assert.equal(health.status, "misconfigured");
  assert.equal(probe.killed, true);
  assert.ok(health.status !== "ready");
  assert.doesNotMatch(JSON.stringify(health), /SECRET_FAKE_CREDENTIAL/);
  assert.match(JSON.stringify(health), /response limit/);
});
