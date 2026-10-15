import assert from "node:assert/strict";
import test from "node:test";
import { summarizeTokenUsage, tokenUsageTimeline, type UsageViewEntry } from "../../src/settings/TokenUsageStats";

const row = (date: string, provider: string, model: string, tokens: number): UsageViewEntry => ({
  date, provider, model, requests: 1, inputTokens: tokens - 2,
  outputTokens: 2, totalTokens: tokens, cachedInputTokens: 1,
  reasoningTokens: 1, cacheWriteTokens: 0,
});

test("All, provider, model and period filters share one projection", () => {
  const rows = [
    row("2026-10-14", "chatgpt", "gpt", 30),
    row("2026-10-13", "chatgpt", "gpt", 15),
    row("2026-09-02", "chatgpt", "gpt", 100),
    row("2026-10-14", "agy", "gemini", 20),
  ];
  const now = new Date("2026-10-14T12:00:00Z");
  const all = summarizeTokenUsage(rows, { provider: "all", model: "all", range: "all" }, now);
  assert.equal(all.totals.totalTokens, 165);
  assert.equal(all.rows.length, 2);
  assert.equal(all.totals.requests, 4);
  const provider = summarizeTokenUsage(rows, { provider: "chatgpt", model: "all", range: "7d" }, now);
  assert.equal(provider.totals.totalTokens, 45);
  assert.equal(provider.totals.requests, 2);
  const model = summarizeTokenUsage(rows, { provider: "all", model: "gemini", range: "30d" }, now);
  assert.equal(model.totals.totalTokens, 20);
  assert.equal(model.rows[0].model, "gemini");
});

test("segmented Token view draws only filtered, actually recorded UTC buckets", () => {
  const entries = [
    row("2026-10-14", "agy", "gemini", 30),
    row("2026-10-14", "agy", "gemini", 10),
    row("2026-10-13", "codex", "gpt", 40),
    row("2026-09-15", "agy", "gemini", 90),
  ];
  const now = new Date("2026-10-14T20:00:00Z");
  const filtered = tokenUsageTimeline(entries,
    {provider:"agy",model:"gemini",range:"7d"},now);
  assert.equal(filtered.length, 7);
  assert.equal(filtered[6].startDate, "2026-10-14");
  assert.equal(filtered[6].inputTokens, 36);
  assert.equal(filtered[6].outputTokens, 4);
  assert.equal(filtered.reduce((sum, bucket) => sum + bucket.inputTokens + bucket.outputTokens,0), 40);

  const monthly = tokenUsageTimeline(entries,
    {provider:"all",model:"all",range:"30d"},now);
  assert.equal(monthly.length, 10);
  assert.equal(monthly.reduce((sum, bucket) => sum + bucket.inputTokens + bucket.outputTokens,0), 80);
  assert.equal(monthly[9].endDate, "2026-10-14");

  const all = tokenUsageTimeline(entries,
    {provider:"codex",model:"all",range:"all"},now);
  assert.equal(all.length, 14);
  assert.equal(all[13].endDate,"2026-10-13");
  assert.equal(all.reduce((sum, b) => sum + b.inputTokens + b.outputTokens, 0),40);
});

test("empty usage must never manufacture a chart or provider quotas", () => {
  const chart = tokenUsageTimeline([], {provider:"all",model:"all",range:"7d"});
  assert.deepEqual(chart, []);
});
