import test from "node:test";
import assert from "node:assert/strict";
import { planWorkspace, planObjectiveLesson, workspaceRoot } from "../../../src/domain/workspace/plan";
import type { LearningProgram } from "../../../src/domain/learning-program/types";

const program: LearningProgram = {
  version: 1, id: "11111111-1111-4111-8111-111111111111", goal: "Learn Japanese / Basics",
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false, sourcePaths: [], excludedTopics: [] },
  objectives: [{ id: "hello", title: "Greetings", outcome: "Greet a visitor", estimatedMinutes: 40,
    prerequisiteIds: [], rubric: ["Appropriate greeting"], sourceRefs: [], priority: "core" }],
  createdAt: Date.now(), planVersion: 1,
};
test("workspace file paths are deterministic and remain below NOX root", () => {
  const plan = planWorkspace(program);
  assert.equal(plan.files.length, 2);
  assert.ok(plan.files.every(file => file.path.startsWith(plan.root + "/")));
  assert.ok(plan.files.every(file => file.content.includes(program.id)));
  assert.equal(plan.root, workspaceRoot(program));
});
test("workspace path rejects untrusted program identities", () => {
  assert.throws(() => workspaceRoot({ id: "../escape", goal: "foo" }), /Invalid workspace/);
});

test("objective template is a deterministic pure plan and validates the objective", () => {
  const lesson = planObjectiveLesson(program, "hello");
  assert.equal(lesson.path, planWorkspace(program).root + "/Lessons/hello.md");
  assert.match(lesson.content, /nox-objective-id: "hello"/);
  assert.match(lesson.content, /Appropriate greeting/);
  assert.deepEqual(planObjectiveLesson(program, "hello"), lesson);
  assert.throws(() => planObjectiveLesson(program, "missing"), /Unknown learning objective/);
});
