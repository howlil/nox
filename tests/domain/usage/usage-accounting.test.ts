import assert from "node:assert/strict";
import test from "node:test";
import {
  accumulateUsage, assertUsageReport, decodeUsageSnapshot,
  type UsageSnapshot,
} from "../../src/domain/usage/usage-accounting";

const now = new Date("2026-10-19T18:30:00.000Z");
const base = (): UsageSnapshot => ({ entries: [] });
const usage = (input: number, output: number) => ({
  inputTokens: input, outputTokens: output, totalTokens: input + output,
});
const id = "a1234567-1234-1234-1234-123456789012";

test("provider buckets are immutable and grouped by UTC date/provider/model", () => {
  const first = base();
  const next = accumulateUsage(first, "chatgpt", "gpt-x", {
    ...usage(12, 8), cachedInputTokens: 4, reasoningTokens: 2,
  }, {}, now)!;
  const merged = accumulateUsage(next, "chatgpt", "gpt-x", usage(20, 5), {}, now)!;
  const another = accumulateUsage(merged, "codex", "gpt-x", usage(1, 1), {}, now)!;
  assert.equal(first.entries.length, 0);
  assert.equal(next.entries[0].totalTokens, 20);
  assert.deepEqual(merged.entries[0], {
    date: "2026-10-19", provider: "chatgpt", model: "gpt-x", requests: 2,
    inputTokens: 32, outputTokens: 13, totalTokens: 45,
    cachedInputTokens: 4, reasoningTokens: 2, cacheWriteTokens: 0,
  });
  assert.equal(another.entries.length, 2);
  assert.equal(another.trackingSince, now.toISOString());
});

test("first observed AGY resumed conversation establishes baseline without claiming past usage", () => {
  const previous = base();
  const report = accumulateUsage(previous, "agy", "gemini", usage(300, 50),
    { conversationId: id, cumulative: true, turnCount: 5 }, now)!;
  assert.equal(previous.entries.length, 0);
  assert.equal(report.entries.length, 0);
  assert.equal(report.agyCheckpoints?.[id].turnCount, 5);
  const next = accumulateUsage(report, "agy", "gemini", usage(320, 65),
    { conversationId: id, cumulative: true, turnCount: 6 }, now)!;
  assert.equal(next.entries[0].totalTokens, 35);
  assert.equal(next.entries[0].requests, 1);
  assert.equal(accumulateUsage(next, "agy", "gemini", usage(320, 65),
    { conversationId: id, cumulative: true, turnCount: 6 }, now), null);
  assert.equal(accumulateUsage(next, "agy", "gemini", usage(2, 2),
    { conversationId: id, cumulative: true, turnCount: 1 }, now), null);
});

test("fresh AGY conversation bills first observed terminal once, even with multiple internal turns", () => {
  const first = accumulateUsage(base(), "agy", "gemini", usage(110, 50),
    { conversationId: id, cumulative: true, turnCount: 3, freshConversation: true }, now)!;
  const next = accumulateUsage(first, "agy", "gemini", usage(190, 80),
    { conversationId: id, cumulative: true, turnCount: 3 }, now)!;
  assert.equal(first.entries[0].totalTokens, 160);
  assert.equal(next.entries[0].totalTokens, 270);
  assert.equal(next.entries[0].requests, 2);
});

test("unattributable cumulative usage is ignored; ordinary providers remain per-request", () => {
  assert.equal(accumulateUsage(base(), "agy", "gemini", usage(10, 5),
    { cumulative: true }, now), null);
  const standard = accumulateUsage(base(), "codex", "", usage(5, 5), {}, now)!;
  assert.equal(standard.entries[0].model, "(runtime default)");
  assert.equal(standard.entries[0].totalTokens, 10);
});

test("persisted decoder excludes malformed buckets and checkpoints but preserves valid prior data", () => {
  const snapshot = decodeUsageSnapshot({
    trackingSince: "2026-10-19T00:00:00Z",
    entries: [
      { date: "2026-10-19", provider: "agy", model: "gemini", requests: 1,
        inputTokens: 4, outputTokens: 5, totalTokens: 9, cachedInputTokens: 1,
        reasoningTokens: 2, cacheWriteTokens: 0 },
      { date: "bad", provider: "agy", model: "gemini", requests: -1 },
    ],
    agyCheckpoints: {
      [id]: { usage: usage(10, 5), turnCount: 3 },
      "malformed-id": { usage: { inputTokens: -100 }, turnCount: 8 },
    },
  });
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.agyCheckpoints?.[id].usage.totalTokens, 15);
  assert.equal(snapshot.agyCheckpoints?.["malformed-id"], undefined);
});

test("invalid optional counters and overflowing totals never become persisted increments", () => {
  assert.throws(() => assertUsageReport("unknown", usage(1, 1)), /Invalid usage provider/);
  assert.throws(() => assertUsageReport("agy", { ...usage(1, 1),
    cachedInputTokens: -2 }), /Invalid token usage/);
  const first = accumulateUsage(base(), "codex", "model", {
    inputTokens: Number.MAX_SAFE_INTEGER - 1, outputTokens: 1,
    totalTokens: Number.MAX_SAFE_INTEGER,
  }, {}, now)!;
  assert.throws(() => accumulateUsage(first, "codex", "model", usage(1, 1), {}, now),
    /safe integer range/);
  assert.equal(first.entries[0].requests, 1);
});
