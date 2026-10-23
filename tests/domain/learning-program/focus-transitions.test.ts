import assert from "node:assert/strict";
import test from "node:test";
import { authorizeFocusIntent, startObjectiveFocus, startEligibleObjectiveFocus, transitionObjectiveFocus, validateObjectiveFocus } from "../../../src/domain/learning-program/focus-transitions";
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

test("M1 criterion evidence remains on pinned objective until independent delayed recall", () => {
  const active = startObjectiveFocus(program(), "race", "chat-a", 10, "focus-m1");
  const criterion = "race@1:criterion-1";
  const attempt = (id: string, at: number, outcome: "correct" | "incorrect",
    taskKind: "guided-practice" | "recall" = "guided-practice", hintLevel: 0 | 2 = 0) => ({
    id, type: "practice" as const, scope: "learner" as const, concept: "Race",
    source: "test", programId: "p", objectiveId: "race", evidenceVersion: 3 as const,
    objectiveRevision: 1, questionId: id, evaluator: "llm-review" as const,
    assistance: { highestHintLevel: hintLevel, independent: hintLevel === 0 },
    outcome, createdAt: at, taskKind,
    rubricResults: [{ criterion: "Explain scheduling", criterionId: criterion,
      met: outcome === "correct", evidence: "explanation" }],
  });
  const assisted = attempt("a", 0, "correct", "guided-practice", 2);
  assert.equal(chooseFocusedActivity(active, [assisted], 100).kind, "guided-practice");
  const corrected = attempt("b", 100, "correct");
  assert.equal(chooseFocusedActivity(active, [assisted, corrected], 200).kind, "wait");
  assert.equal(chooseFocusedActivity(active, [assisted, corrected], 12 * 3_600_000 + 101).kind, "recall");
  const recall = attempt("c", 13 * 3_600_000, "correct", "recall");
  assert.equal(chooseFocusedActivity(active, [assisted, corrected, recall], recall.createdAt + 1).kind, "wait");
  const regression = attempt("d", recall.createdAt + 100, "incorrect", "recall");
  assert.equal(chooseFocusedActivity(active, [assisted, corrected, recall, regression], regression.createdAt + 1).kind, "teach");
});

test("M1 old rubric revision cannot become ready under a revised pinned focus", () => {
  const revised = startObjectiveFocus({ ...program(), planVersion: 2 }, "race", "chat-a", 10, "focus-revised");
  const previous = {
    id: "old", type: "practice" as const, scope: "learner" as const, concept: "Race",
    source: "test", programId: "p", objectiveId: "race", evidenceVersion: 3 as const,
    objectiveRevision: 1, questionId: "old", evaluator: "llm-review" as const,
    assistance: { highestHintLevel: 0 as const, independent: true },
    outcome: "correct", createdAt: 1,
    rubricResults: [{ criterion: "Explain scheduling", criterionId: "race@1:criterion-1",
      met: true, evidence: "old answer" }],
  };
  assert.equal(chooseFocusedActivity(revised, [previous], 90_000_000).kind, "diagnostic");
});

test("focus admission enforces prerequisite mastery inside the domain", () => {
  const first = program();
  const gated = { ...first, objectives: [...first.objectives, {
    ...first.objectives[0], id: "advanced", title: "Advanced",
    prerequisiteIds: ["race"],
  }] };
  const state = { version: 3 as const, target: null, gaps: [], evidence: [] };
  assert.throws(() => startEligibleObjectiveFocus(gated, state,
    "advanced", "chat-a", 10, "focus-2"), /Prerequisites are not mastered/);
  assert.equal(startEligibleObjectiveFocus(gated, state, "race", "chat-a",
    10, "focus-1").focus?.objectiveId, "race");
});
