import assert from "node:assert/strict";
import test from "node:test";
import { authorizeFocusIntent, startObjectiveFocus, transitionObjectiveFocus, validateObjectiveFocus } from "../../../src/domain/learning-program/focus-transitions";
import { chooseFocusedActivity } from "../../../src/domain/learning-program/rules";
import type { LearningProgram } from "../../../src/domain/learning-program/types";

function program(): LearningProgram {
  return { version: 1, id: "p", goal: "Learn concurrency", createdAt: 1, planVersion: 1,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourcePaths: [],
      sourceBound: false, excludedTopics: [], deadline: "2020-01-01" },
    objectives: [{ id: "race", title: "Race", outcome: "Explain races",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain scheduling"],
      sourceRefs: [], priority: "core" }] };
}

test("self-paced focus ignores expired deadlines, missing sessions and elapsed wall clock", () => {
  const active = startObjectiveFocus(program(), "race", "chat-a", 10, "focus-1");
  assert.equal(active.session, undefined);
  assert.equal(active.focus?.objectiveId, "race");
  assert.equal(chooseFocusedActivity(active, [], 999_999_999_999).kind, "diagnostic");
  validateObjectiveFocus(active, active.focus!);
  const paused = transitionObjectiveFocus(active, "pause", 30);
  assert.equal(paused.focus?.status, "paused");
  assert.equal(chooseFocusedActivity(paused, [], 100).kind, "wait");
  const resumed = transitionObjectiveFocus(paused, "resume", 40);
  assert.equal(resumed.focus?.id, active.focus?.id);
  assert.equal(transitionObjectiveFocus(resumed, "end", 60).focus, undefined);
});

test("authorization rejects other chat, other objective, unrelated actions and suspended practice", () => {
  const active = startObjectiveFocus(program(), "race", "chat-a", 10, "focus-1");
  assert.deepEqual(authorizeFocusIntent(active.focus, { kind: "continue", chatSessionId: "chat-a" }), { allowed: true });
  assert.deepEqual(authorizeFocusIntent(active.focus, { kind: "submit-answer",
    chatSessionId: "chat-b" }), { allowed: false, reason: "wrong-chat" });
  assert.deepEqual(authorizeFocusIntent(active.focus, { kind: "submit-answer",
    chatSessionId: "chat-a", objectiveId: "other" }), { allowed: false, reason: "wrong-objective" });
  assert.deepEqual(authorizeFocusIntent(active.focus, { kind: "unrelated" }),
    { allowed: false, reason: "focus-active" });
  const paused = transitionObjectiveFocus(active, "pause", 20);
  assert.equal(authorizeFocusIntent(paused.focus, { kind: "continue", chatSessionId: "chat-a" }).allowed, false);
  assert.equal(authorizeFocusIntent(paused.focus, { kind: "resume" }).allowed, true);
});

test("duplicate focus and stale revision are rejected without mutations", () => {
  const active = startObjectiveFocus(program(), "race", "chat-a", 10, "focus-1");
  assert.throws(() => startObjectiveFocus(active, "race", "chat-a", 20, "focus-2"), /End the existing/);
  assert.throws(() => startObjectiveFocus(program(), "unknown", "chat-a", 20, "focus-2"), /Unknown objective/);
  const stale = { ...active, planVersion: 2 };
  assert.throws(() => validateObjectiveFocus(stale, stale.focus!), /Invalid persisted/);
  const paused = transitionObjectiveFocus(active, "pause", 30);
  assert.throws(() => transitionObjectiveFocus({ ...paused, planVersion: 2 }, "resume", 40), /curriculum changed/);
});
