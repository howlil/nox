import assert from "node:assert/strict";
import test from "node:test";
import { allowsFocusedTurn, startObjectiveFocus, transitionObjectiveFocus, validateObjectiveFocus } from "../../../src/domain/learning-program/focus-transitions";
import { chooseNextActivity } from "../../../src/domain/learning-program/rules";
import type { LearningProgram } from "../../../src/domain/learning-program/types";

const program: LearningProgram = {
  version: 1, id: "science", goal: "Scientific reasoning", planVersion: 1, createdAt: 100,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourcePaths: [], sourceBound: false, excludedTopics: [] },
  objectives: [{
    id: "evidence", title: "Evidence", outcome: "Evaluate evidence", prerequisiteIds: [],
    estimatedMinutes: 30, rubric: ["Identify evidence"], sourceRefs: [], priority: "core",
  }],
};

test("self-paced focus pins activity independently of timing and deadline", () => {
  const focused = startObjectiveFocus({ ...program, constraints: {
    ...program.constraints, deadline: "2020-01-01",
  } }, "evidence", 200, "focus-a");
  assert.equal(chooseNextActivity(focused, [], 300).kind, "diagnostic");
  assert.equal(chooseNextActivity(focused, [], 300).objective?.id, "evidence");
  assert.throws(() => startObjectiveFocus(focused, "evidence", 300, "focus-b"), /already exists/);
});

test("pause, resume, and end keep focus identity and validate persisted state", () => {
  const focused = startObjectiveFocus(program, "evidence", 200, "focus-a");
  const paused = transitionObjectiveFocus(focused, "pause", 300);
  assert.equal(chooseNextActivity(paused, [], 400).kind, "wait");
  const recovered = structuredClone(paused);
  validateObjectiveFocus(recovered, recovered.focus!);
  const resumed = transitionObjectiveFocus(recovered, "resume", 500);
  assert.equal(resumed.focus?.id, "focus-a");
  assert.equal(resumed.focus?.status, "active");
  assert.equal(transitionObjectiveFocus(resumed, "end", 600).focus, undefined);
});

test("focus admission denies chat mode and free-practice escape hatches", () => {
  assert.equal(allowsFocusedTurn("/next", false), true);
  assert.equal(allowsFocusedTurn("/pause-focus", false), true);
  assert.equal(allowsFocusedTurn("/free-practice", true), false);
  assert.equal(allowsFocusedTurn("/mode free", false), false);
  assert.equal(allowsFocusedTurn("unrelated chat", false), false);
  assert.equal(allowsFocusedTurn("answer", true), true);
});

test("stale revision and unknown objective reject focused transitions", () => {
  const focused = startObjectiveFocus(program, "evidence", 200, "focus-a");
  assert.throws(() => validateObjectiveFocus({ ...focused, planVersion: 2 }, focused.focus!), /Invalid persisted/);
  assert.throws(() => startObjectiveFocus(program, "missing", 200, "id"), /Unknown/);
});
