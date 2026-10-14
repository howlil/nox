import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "../../src/agent/AgentRuntime";
import type { AgentAdapter, AgentStreamEvent } from "../../src/types";

test("runtime records usage without emitting telemetry into learning events", async () => {
  const events: AgentStreamEvent[] = [
    { type: "text", content: "hello" },
    { type: "usage", usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 }, model: "actual" },
    { type: "completed" },
  ];
  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => [],
    async *send() { yield* events; },
  };
  const recorded: string[] = [];
  const runtime = new AgentRuntime(adapter, async (usage, model) => {
    recorded.push(model + ":" + usage.totalTokens);
  });
  const received: AgentStreamEvent[] = [];
  for await (const event of runtime.send({ prompt: "x", context: [] }, {},
    new AbortController().signal)) received.push(event);
  assert.deepEqual(received, [events[0], events[2]]);
  assert.deepEqual(recorded, ["actual:25"]);
});
test("ledger failure does not turn a successful AI response into a failed turn", async () => {
  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => [],
    async *send() {
      yield { type: "usage", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } } as const;
      yield { type: "completed" } as const;
    },
  };
  const runtime = new AgentRuntime(adapter, async () => { throw new Error("disk"); });
  const received: string[] = [];
  for await (const event of runtime.send({ prompt: "x", context: [] }, {},
    new AbortController().signal)) received.push(event.type);
  assert.deepEqual(received, ["completed"]);
  assert.match(runtime.getUsageTrackingError() || "", /could not be saved/i);
});
