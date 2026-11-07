import assert from "node:assert/strict";
import test from "node:test";
import { prepareContextEnvelope, compactHistory, estimateTokens } from "../../packages/core/src/context/ContextBudget";

test("context budget bounds oversized attachments without mutating input", () => {
  const note = { type: "note" as const, file: "large.md", content: "TCP congestion control RTT throughput. ".repeat(4000) };
  const context = [note];
  const result = prepareContextEnvelope({
    prompt: "Explain RTT and throughput",
    visible: context, system: [],
    history: [],
    maxInputTokens: 2200,
  });
  assert.ok(result.estimate.total <= 2200);
  assert.ok(result.estimate.shortenedSources > 0);
  assert.equal(note.content.length, context[0].content.length);
  assert.ok(result.context[0].content.includes("excerpts"));
});

test("strict workflow refuses losing required source rather than silently clipping", () => {
  assert.throws(() => prepareContextEnvelope({
    prompt: "Edit all text", strict: true, maxInputTokens: 1600,
    visible: [{ type: "note", file: "source.md", content: "data ".repeat(5000) }],
    system: [], history: [],
  }), /context budget/i);
});

test("older history is summarized within a bounded local budget", () => {
  const history = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 ? "assistant" as const : "user" as const,
    content: "Technical choice " + i + " ".repeat(50),
  }));
  const result = prepareContextEnvelope({
    prompt: "Continue the design", visible: [], system: [], history, maxInputTokens: 4000,
  });
  assert.equal(result.estimate.compacted, true);
  assert.ok(result.history.length <= 6);
  assert.ok(result.promptPrefix.includes("lossy summary"));
  assert.ok(result.estimate.total <= 4000);
  assert.ok(compactHistory(history).length <= 1300);
  assert.ok(estimateTokens(result.promptPrefix) > 0);
});

test("deduplicates identical source and records estimates, not actual provider usage", () => {
  const item = { type: "note" as const, file: "a.md", content: "Some context" };
  const result = prepareContextEnvelope({
    prompt: "Explain", visible: [item, item], system: [], history: [],
  });
  assert.equal(result.context.length, 1);
  assert.equal(result.estimate.compacted, false);
});

test("multilingual memory cannot exceed its history allocation", () => {
  const history = Array.from({ length: 80 }, (_, i) => ({
    role: (i % 2 ? "assistant" : "user") as "assistant" | "user",
    content: ("会話の記録と学習情報 ").repeat(500) + i,
  }));
  const result = prepareContextEnvelope({
    prompt: "Summarize the networking concept", visible: [], system: [], history,
    maxInputTokens: 1800,
  });
  assert.ok(result.estimate.total <= 1800);
  assert.ok(result.estimate.history <= Math.floor(1800 * 0.24));
});
