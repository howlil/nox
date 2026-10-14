import test from "node:test";
import assert from "node:assert/strict";
import { decodeTokenUsage, isAgentUsageRecord, summarizeUsage } from "../../src/domain/telemetry/token-usage";

test("provider usage decodes only validated non-negative integers", () => {
  assert.deepEqual(decodeTokenUsage({
    input_tokens: 400, output_tokens: 100,
    input_tokens_details: { cached_tokens: 120 },
  }), { inputTokens: 400, outputTokens: 100, cachedInputTokens: 120 });
  assert.equal(decodeTokenUsage({ input_tokens: -1, output_tokens: 1 }), null);
  assert.equal(decodeTokenUsage({ input_tokens: 1.5, output_tokens: 1 }), null);
  assert.equal(decodeTokenUsage({ input_tokens: 1 }), null);
  assert.deepEqual(decodeTokenUsage({
    input_tokens: 10, output_tokens: 5, cached_input_tokens: 11,
  }), { inputTokens: 10, outputTokens: 5 });
});

test("durable receipts enforce bounded and safe metadata", () => {
  const valid = { id: "turn-1", at: 123, provider: "chatgpt", model: "a",
    inputTokens: 100, outputTokens: 20, cachedInputTokens: 30 };
  assert.equal(isAgentUsageRecord(valid), true);
  assert.equal(isAgentUsageRecord({ ...valid, at: NaN }), false);
  assert.equal(isAgentUsageRecord({ ...valid, cachedInputTokens: 200 }), false);
  assert.deepEqual(summarizeUsage([valid, { ...valid, id: "turn-2", outputTokens: 15 }]), {
    requests: 2, inputTokens: 200, outputTokens: 35, cachedInputTokens: 60,
  });
});
