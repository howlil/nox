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
  assert.deepEqual(await runtime.check(), { status: "ready" });
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
