import assert from "node:assert/strict";
import test from "node:test";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";
import { TokenUsageRepository } from "../../src/persistence/TokenUsageRepository";

test("daily tokens and requests aggregate across models without storing prompts", async () => {
  let state: Record<string, unknown> = { "nox-settings": { provider: "agy" } };
  const source = new PluginDataRepository({
    loadData: async () => state,
    saveData: async (value: Record<string, unknown>) => { state = value; },
  } as never);
  const ledger = new TokenUsageRepository(source);
  await ledger.record("chatgpt", "gpt-a", { inputTokens: 10, outputTokens: 5,
    totalTokens: 15, cachedInputTokens: 4, reasoningTokens: 2 });
  await ledger.record("chatgpt", "gpt-a", { inputTokens: 20, outputTokens: 10, totalTokens: 30 });
  await ledger.record("codex", "gpt-b", { inputTokens: 3, outputTokens: 2, totalTokens: 5 });
  const snapshot = await ledger.snapshot();
  assert.equal(snapshot.entries.length, 2);
  const chat = snapshot.entries.find(item => item.provider === "chatgpt")!;
  assert.equal(chat.requests, 2);
  assert.equal(chat.totalTokens, 45);
  assert.equal(chat.cachedInputTokens, 4);
  assert.equal(chat.reasoningTokens, 2);
  assert.deepEqual(state["nox-settings"], { provider: "agy" });
  assert.equal(JSON.stringify(state).includes("prompt"), false);
});

test("AGY resumed conversation uses cumulative delta and skips unobserved history", async () => {
  let state: Record<string, unknown> = {};
  const repo = new TokenUsageRepository(new PluginDataRepository({
    loadData: async () => state,
    saveData: async (value: Record<string, unknown>) => { state = value; },
  } as never));
  const usage = (total: number) => ({
    inputTokens: total - 20, outputTokens: 20, totalTokens: total,
  });
  const id = "a1234567-1234-1234-1234-123456789012";
  await repo.record("agy", "gemini", usage(300), { conversationId: id, cumulative: true, turnCount: 5 });
  assert.equal((await repo.snapshot()).entries.length, 0);
  await repo.record("agy", "gemini", usage(345), { conversationId: id, cumulative: true, turnCount: 6 });
  let snapshot = await repo.snapshot();
  assert.equal(snapshot.entries[0].totalTokens, 45);
  assert.equal(snapshot.entries[0].requests, 1);
  await repo.record("agy", "gemini", usage(345), { conversationId: id, cumulative: true, turnCount: 6 });
  snapshot = await repo.snapshot();
  assert.equal(snapshot.entries[0].requests, 1);
});

test("failed plugin writes never publish token increments", async () => {
  let state: Record<string, unknown> = {};
  let fail = false;
  const repo = new TokenUsageRepository(new PluginDataRepository({
    loadData: async () => state,
    saveData: async (value: Record<string, unknown>) => {
      if (fail) throw new Error("disk failure");
      state = value;
    },
  } as never));
  await repo.record("codex", "a", { inputTokens: 10, outputTokens: 10, totalTokens: 20 });
  fail = true;
  await assert.rejects(repo.record("codex", "a", { inputTokens: 10, outputTokens: 10, totalTokens: 20 }));
  assert.equal((await repo.snapshot()).entries[0].totalTokens, 20);
});
