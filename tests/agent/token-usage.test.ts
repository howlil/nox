import assert from "node:assert/strict";
import test from "node:test";
import { parseAgyUsage, parseChatGptUsage, parseCodexUsage } from "../../src/agent/token-usage";

test("Responses usage preserves inclusive cached and reasoning counts", () => {
  assert.deepEqual(parseChatGptUsage({ usage: {
    input_tokens: 100, output_tokens: 40, total_tokens: 140,
    input_tokens_details: { cached_tokens: 70 },
    output_tokens_details: { reasoning_tokens: 15 },
  } }), { inputTokens: 100, outputTokens: 40, totalTokens: 140,
    cachedInputTokens: 70, reasoningTokens: 15 });
});
test("AGY usage is parsed from result envelope without estimating missing values", () => {
  assert.deepEqual(parseAgyUsage({ usage: {
    input_tokens: 250, output_tokens: 50, total_tokens: 300,
    thinking_tokens: 20, cache_read_tokens: 100,
  } }), { inputTokens: 250, outputTokens: 50, totalTokens: 300,
    cachedInputTokens: 100, reasoningTokens: 20 });
  assert.equal(parseAgyUsage({ usage: { input_tokens: 400 } }), null);
});
test("Codex reports turn usage and missing total is the safe sum", () => {
  assert.deepEqual(parseCodexUsage({ usage: {
    input_tokens: 80, output_tokens: 30, cached_input_tokens: 20,
  } }), { inputTokens: 80, outputTokens: 30, totalTokens: 110, cachedInputTokens: 20 });
});
test("invalid or absent metadata is never recorded as a fake zero", () => {
  for (const value of [null, {}, { usage: {} }, { usage: {
    input_tokens: -1, output_tokens: 2, total_tokens: 3,
  } }, { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }]) {
    assert.equal(parseChatGptUsage(value), null);
  }
});
