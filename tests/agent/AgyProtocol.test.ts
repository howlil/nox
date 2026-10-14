import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAgyUserMessage,
  parseAgyLine,
} from "../../src/agent/AgyProtocol";

test("encodes multiline unicode prompts as one JSON line", () => {
  const line = encodeAgyUserMessage(
    'hello "Nox"\nこんにちは\\path',
  );

  assert.equal(line.endsWith("\n"), true);
  const parsed = JSON.parse(line.trim());
  assert.equal(parsed.event, "user");
  assert.equal(
    parsed.message.content,
    'hello "Nox"\nこんにちは\\path',
  );
});

test("init captures top-level and nested conversation ids", () => {
  const top = parseAgyLine(
    JSON.stringify({
      event: "init",
      conversation_id: "top",
    }),
    { sawText: false },
  );

  assert.equal(top.state.conversationId, "top");

  const nested = parseAgyLine(
    JSON.stringify({
      event: "init",
      init: { conversation_id: "nested" },
    }),
    { sawText: false },
  );

  assert.equal(nested.state.conversationId, "nested");
});

test("step updates emit text and mark text as seen", () => {
  const parsed = parseAgyLine(
    JSON.stringify({
      event: "step_update",
      step_update: { text_delta: "streamed" },
    }),
    { sawText: false },
  );

  assert.deepEqual(parsed.events, [
    { type: "text", content: "streamed" },
  ]);
  assert.equal(parsed.state.sawText, true);
  assert.equal(parsed.terminal, false);
});

test("uses result.response when no text delta was emitted", () => {
  const parsed = parseAgyLine(
    JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: "final answer",
        conversation_id: "conversation-1",
      },
    }),
    { sawText: false },
  );

  assert.deepEqual(parsed.events, [
    { type: "text", content: "final answer" },
    {
      type: "completed",
      conversationId: "conversation-1",
    },
  ]);
  assert.equal(parsed.terminal, true);
});

test("does not duplicate result.response after streamed text", () => {
  const streamed = parseAgyLine(
    JSON.stringify({
      event: "step_update",
      step_update: { text_delta: "streamed" },
    }),
    { sawText: false },
  );

  const completed = parseAgyLine(
    JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: "streamed",
      },
    }),
    streamed.state,
  );

  assert.deepEqual(completed.events, [
    { type: "completed", conversationId: undefined },
  ]);
});

for (const status of [
  "CANCELED",
  "CANCELLED",
  "INTERRUPTED",
]) {
  test(`maps ${status} to cancellation`, () => {
    const parsed = parseAgyLine(
      JSON.stringify({
        event: "result",
        result: { status },
      }),
      { sawText: false },
    );

    assert.deepEqual(parsed.events, [
      { type: "cancelled" },
    ]);
    assert.equal(parsed.terminal, true);
  });
}

test("classifies permission and protocol failures", () => {
  const permission = parseAgyLine(
    JSON.stringify({
      event: "error",
      error: "permission approval required",
    }),
    { sawText: false },
  );

  const protocol = parseAgyLine(
    JSON.stringify({
      event: "error",
      error: "invalid json protocol",
    }),
    { sawText: false },
  );

  assert.equal(
    permission.events[0]?.type === "failed"
      ? permission.events[0].failure.code
      : undefined,
    "permission-required",
  );

  assert.equal(
    protocol.events[0]?.type === "failed"
      ? protocol.events[0].failure.code
      : undefined,
    "protocol-invalid",
  );
});

test("rejects result events without a terminal status", () => {
  const parsed = parseAgyLine(
    JSON.stringify({
      event: "result",
      result: { response: "ambiguous" },
    }),
    { sawText: false },
  );

  assert.equal(parsed.terminal, true);
  assert.equal(parsed.events[0]?.type, "failed");

  if (parsed.events[0]?.type === "failed") {
    assert.equal(
      parsed.events[0].failure.code,
      "protocol-invalid",
    );
  }
});

test("ignores malformed JSON until the process boundary decides the final outcome", () => {
  const previous = {
    sawText: true,
    conversationId: "existing",
  };

  const parsed = parseAgyLine("{not-json", previous);

  assert.deepEqual(parsed.events, []);
  assert.deepEqual(parsed.state, previous);
  assert.equal(parsed.terminal, false);
});


test("successful AGY result reports cumulative counters for ledger delta tracking", () => {
  const parsed = parseAgyLine(JSON.stringify({ event: "result",
    result: { status: "SUCCESS", conversation_id: "c1", num_turns: 2,
      response: "done", usage: { input_tokens: 100, output_tokens: 25,
        total_tokens: 125, cache_read_tokens: 20, thinking_tokens: 5 } },
  }), { sawText: true });
  assert.deepEqual(parsed.events[0], {
    type: "usage", conversationId: "c1", cumulative: true, turnCount: 2,
    model: undefined, usage: {
      inputTokens: 100, outputTokens: 25, totalTokens: 125,
      cachedInputTokens: 20, reasoningTokens: 5,
    },
  });
  assert.equal(parsed.events[1]?.type, "completed");
});
