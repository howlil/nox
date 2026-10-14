import test from "node:test";
import assert from "node:assert/strict";
import { reduceAgentUIEvent, type AgentRunViewState } from "../../src/agent/ui-events";

const start = () => reduceAgentUIEvent(null, {
  type: "run.started", runId: "r1", at: 10, provider: "agy",
}) as AgentRunViewState;

test("requires start and rejects cross-run events", () => {
  assert.equal(reduceAgentUIEvent(null, { type: "message.delta", runId: "r1", at: 11, text: "a" }), null);
  const s = start();
  assert.equal(reduceAgentUIEvent(s, { type: "message.delta", runId: "r2", at: 11, text: "a" }), s);
});
test("tool IDs are idempotent and late events are ignored", () => {
  const s = start();
  const e = { type: "tool.started" as const, runId: "r1", at: 11, toolCallId: "t1", name: "search" };
  const a = reduceAgentUIEvent(s, e)!;
  assert.equal(reduceAgentUIEvent(a, e), a);
  const b = reduceAgentUIEvent(a, {
    type: "tool.finished", runId: "r1", at: 12, toolCallId: "t1", outcome: "completed",
  })!;
  assert.equal(b.tools[0].outcome, "completed");
  const c = reduceAgentUIEvent(b, { type: "run.finished", runId: "r1", at: 13, outcome: "completed" })!;
  assert.equal(reduceAgentUIEvent(c, { type: "message.delta", runId: "r1", at: 14, text: "late" }), c);
});
test("missing usage is unknown, not zero", () => {
  const s = start();
  assert.equal(s.usage, undefined);
  const invalid = reduceAgentUIEvent(s, {
    type: "usage.reported", runId: "r1", at: 12, inputTokens: -1, source: "provider",
  });
  assert.equal(invalid, s);
  const a = reduceAgentUIEvent(s, {
    type: "usage.reported", runId: "r1", at: 12, inputTokens: 120, source: "provider",
  })!;
  assert.equal(a.usage?.inputTokens, 120);
  assert.equal(a.usage?.outputTokens, undefined);
});
test("approval requires a request and can be resolved once", () => {
  const s = start();
  assert.equal(reduceAgentUIEvent(s, {
    type: "approval.resolved", runId: "r1", at: 11, approvalId: "a1", decision: "approved",
  }), s);
  const pending = reduceAgentUIEvent(s, {
    type: "approval.requested", runId: "r1", at: 11, approvalId: "a1", summary: "Read external file",
  })!;
  const resolved = reduceAgentUIEvent(pending, {
    type: "approval.resolved", runId: "r1", at: 12, approvalId: "a1", decision: "rejected",
  })!;
  assert.equal(resolved.approvals[0].decision, "rejected");
});
