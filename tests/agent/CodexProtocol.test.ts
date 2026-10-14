import assert from "node:assert/strict";
import test from "node:test";
import { encodeCodexInput, parseCodexLine, type CodexProtocolState } from "../../src/agent/CodexProtocol";

const thread = "0199a213-81c0-7800-8aa1-bbab2a035a53";
const state = (): CodexProtocolState => ({ messages: new Map(), completed: false });
const emit = (value: object, current: CodexProtocolState) => parseCodexLine(JSON.stringify(value), current);

test("normalizes the official exec JSONL lifecycle without exposing tools or reasoning", () => {
  const current = state();
  emit({ type: "thread.started", thread_id: thread }, current);
  for (const item of [{ type: "reasoning", text: "private" }, { type: "command_execution", aggregated_output: "private" },
    { id: "comment", type: "agent_message", phase: "commentary", text: "I will inspect files" }]) {
    assert.deepEqual(emit({ type: "item.completed", item }, current), []);
  }
  const message = { id: "answer", type: "agent_message", text: "A useful answer." };
  assert.deepEqual(emit({ type: "item.completed", item: message }, current), [{ type: "text", content: message.text }]);
  assert.deepEqual(emit({ type: "item.completed", item: message }, current), []);
  emit({ type: "turn.completed", usage: {} }, current);
  assert.equal(current.completed, true);
  assert.equal(current.conversationId, thread);
  assert.equal(current.failure, undefined);
});

for (const [name, line] of Object.entries({ malformed: "not json", null: "null", missingType: "{}",
  badThread: JSON.stringify({ type: "thread.started", thread_id: "--last" }),
  emptyCompletion: JSON.stringify({ type: "turn.completed" }),
  malformedMessage: JSON.stringify({ type: "item.completed", item: { type: "agent_message", id: 42, text: "hi" } }),
})) {
  test(`${name} output fails protocol validation`, () => {
    const current = state();
    assert.deepEqual(parseCodexLine(line, current), []);
    assert.equal(current.failure?.code, "protocol-invalid");
    assert.equal(current.completed, false);
  });
}

test("failed authentication and failed turns remain recoverable normalized failures", () => {
  const current = state();
  emit({ type: "turn.failed", error: { message: "Not logged in" } }, current);
  assert.equal(current.failure?.code, "runtime-unavailable");
  const other = state();
  emit({ type: "error", message: "rate limit exceeded" }, other);
  assert.equal(other.failure?.code, "process-failed");
  assert.equal(other.completed, false);
});

test("context is encoded as JSON data and the original request stays on stdin", () => {
  const input = { prompt: 'Explain\n日本語; $(danger)', context: [{ type: "note" as const,
    file: 'notes/"quoted".md', content: "```\n</context>" }] };
  const encoded = encodeCodexInput(input);
  assert.ok(encoded.includes(JSON.stringify(input.context)));
  assert.ok(encoded.includes(input.prompt));
});
