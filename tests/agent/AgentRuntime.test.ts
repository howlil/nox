import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "../../src/agent/AgentRuntime";
import { AgentAdapter } from "../../src/types";

test("runtime initialization tolerates model discovery failure", async () => {
  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => {
      throw new Error("models unavailable");
    },
    send: async function* () {
      yield { type: "completed" };
    },
  };

  const runtime = new AgentRuntime(adapter);
  await runtime.init();

  assert.deepEqual(runtime.getModels(), []);
  assert.equal(runtime.getModelDiscoveryError(), "models unavailable");
  assert.deepEqual(await runtime.check(), { status: "ready" });
});

test("changing adapter discards the previous catalog and sends through the new runtime", async () => {
  const agy: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => [{ id: "agy-model", name: "AGY model" }],
    send: async function* () { yield { type: "text", content: "agy" }; },
  };
  const codex: AgentAdapter = {
    check: async () => ({ status: "ready" }), listModels: async () => [],
    send: async function* () { yield { type: "text", content: "codex" }; },
  };
  const runtime = new AgentRuntime(agy);
  await runtime.init();
  await runtime.replaceAdapter(codex);
  assert.deepEqual(runtime.getModels(), []);
  const events = [];
  for await (const event of runtime.send({ prompt: "hello", context: [] }, {}, new AbortController().signal)) events.push(event);
  assert.deepEqual(events, [{ type: "text", content: "codex" }]);
  await runtime.replaceAdapter(agy);
  assert.deepEqual(runtime.getModels(), []);
  await runtime.refreshModels();
  assert.deepEqual(runtime.getModels(), [{ id: "agy-model", name: "AGY model" }]);
});

test("late old catalog cannot overwrite a new provider and disposal cancels discovery", async () => {
  let resolveOld!: (models: Array<{ id: string; name: string }>) => void;
  let oldSignal!: AbortSignal;
  const old: AgentAdapter = {
    check: async () => ({ status: "ready" }), send: async function* () {},
    listModels: (signal) => {
      oldSignal = signal!;
      return new Promise((resolve) => { resolveOld = resolve; });
    },
  };
  const runtime = new AgentRuntime(old);
  const pending = runtime.init();
  await runtime.replaceAdapter({ ...old, listModels: async () => [{ id: "new", name: "New model" }] });
  assert.equal(oldSignal.aborted, true);
  resolveOld([{ id: "old", name: "Old model" }]);
  await pending;
  assert.deepEqual(runtime.getModels(), []);
  await runtime.refreshModels();
  assert.deepEqual(runtime.getModels(), [{ id: "new", name: "New model" }]);
  await runtime.replaceAdapter(old);
  const discovering = runtime.refreshModels();
  runtime.dispose();
  assert.equal(oldSignal.aborted, true);
  resolveOld([{ id: "old", name: "Old model" }]);
  await discovering;
  assert.deepEqual(runtime.getModels(), []);
});

test("runtime forwards normalized turn execution without owning conversation state", async () => {
  let receivedModel: string | undefined;
  let receivedConversationId: string | undefined;

  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => [{ id: "model-a", name: "Model A" }],
    send: async function* (_input, opts) {
      receivedModel = opts.model;
      receivedConversationId = opts.conversationId;
      yield { type: "text", content: "answer" };
      yield { type: "completed", conversationId: "conversation-2" };
    },
  };

  const runtime = new AgentRuntime(adapter);
  await runtime.init();

  const events = [];
  for await (const event of runtime.send(
    { prompt: "hello", context: [] },
    { model: "model-a", conversationId: "conversation-1" },
    new AbortController().signal,
  )) {
    events.push(event);
  }

  assert.equal(receivedModel, "model-a");
  assert.equal(receivedConversationId, "conversation-1");
  assert.equal(events.at(-1)?.type, "completed");
  assert.deepEqual(runtime.getModels(), [{ id: "model-a", name: "Model A" }]);
});

test("model discovery error is cleared on retry and never survives provider swap", async () => {
  let shouldFail = true;
  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    send: async function* () {},
    listModels: async () => {
      if (shouldFail) throw new Error("ChatGPT model discovery failed (HTTP 403).");
      return [{ id: "model-x", name: "Model X" }];
    },
  };
  const runtime = new AgentRuntime(adapter);
  await runtime.init();
  assert.equal(runtime.getModelDiscoveryError(), "ChatGPT model discovery failed (HTTP 403).");
  shouldFail = false;
  await runtime.refreshModels();
  assert.equal(runtime.getModelDiscoveryError(), undefined);
  assert.deepEqual(runtime.getModels(), [{ id: "model-x", name: "Model X" }]);
  await runtime.replaceAdapter({ ...adapter, listModels: async () => [] });
  assert.equal(runtime.getModelDiscoveryError(), undefined);
  await runtime.refreshModels();
  assert.match(runtime.getModelDiscoveryError() ?? "", /No models available/);
});

test("provider replacement never launches model discovery before an explicit request", async () => {
  let calls = 0;
  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => { calls++; return []; },
    send: async function* () {},
  };
  const runtime = new AgentRuntime(adapter);
  await runtime.replaceAdapter(adapter);
  assert.equal(calls, 0);
  await runtime.refreshModels();
  assert.equal(calls, 1);
});
