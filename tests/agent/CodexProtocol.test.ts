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

test("streams cumulative assistant updates without duplicating item.completed", () => {
  const current = state();
  emit({ type: "thread.started", thread_id: thread }, current);
  const update = (text: string, type = "item.updated") => emit({
    type, item: { type: "agent_message", id: "a", text },
  }, current);
  assert.deepEqual(update("Hel"), [{ type: "text", content: "Hel" }]);
  assert.deepEqual(update("Hello"), [{ type: "text", content: "lo" }]);
  assert.deepEqual(update("Hello", "item.completed"), []);
  emit({ type: "turn.completed" }, current);
  assert.equal(current.completed, true);
});
test("rejects contradictory cumulative assistant updates", () => {
  const current = state();
  emit({ type: "item.updated", item: { type: "agent_message", id: "a", text: "Earlier" } }, current);
  emit({ type: "item.completed", item: { type: "agent_message", id: "a", text: "Different" } }, current);
  assert.equal(current.failure?.code, "protocol-invalid");
});


test("completed Codex JSONL event emits exact per-turn token usage", () => {
  const current = state();
  emit({ type: "thread.started", thread_id: thread }, current);
  emit({ type: "item.completed", item: { type: "agent_message", id: "a", text: "ok" } }, current);
  assert.deepEqual(emit({ type: "turn.completed", usage: {
    input_tokens: 120, cached_input_tokens: 30, output_tokens: 40,
  } }, current), [{
    type: "usage", model: undefined,
    usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160, cachedInputTokens: 30 },
  }]);
});

test("tool lifecycle metadata never exposes command arguments or private output", () => {
  const current = state();
  const started = emit({ type: "item.started",
    item: { id: "tool-a", type: "command_execution", command: "secret", aggregated_output: "private" } }, current);
  assert.deepEqual(started, [{ type: "tool-started", toolCallId: "tool-a", name: "command execution" }]);
  const ended = emit({ type: "item.completed",
    item: { id: "tool-a", type: "command_execution", status: "failed", aggregated_output: "private" } }, current);
  assert.deepEqual(ended, [{ type: "tool-completed", toolCallId: "tool-a", outcome: "failed" }]);
  assert.equal(JSON.stringify([...started, ...ended]).includes("secret"), false);
  assert.equal(JSON.stringify([...started, ...ended]).includes("private"), false);
});
