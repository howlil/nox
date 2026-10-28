import assert from "node:assert/strict";
import test from "node:test";
import { projectProgramFocus } from "../../packages/core/src/features/learning/program/ProgramReadModel";
import type { LearningProgram, ProgramCollection } from "../../src/domain/learning-program/types";

const example = (id: string): LearningProgram => ({ id, goal: id, createdAt: 1, planVersion: 1,
  version: 2, constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false, sourcePaths: [], excludedTopics: [] }, objectives: [] });

test("W1 focus read projection shares original collection references without mutation", () => {
  const one = example("active");
  const other = example("focused");
  other.focus = { id: "focus-1", programId: other.id, objectiveId: "obj",
    curriculumRevision: 1, chatSessionId: "session-1", status: "active", startedAt: 1 };
  const collection: ProgramCollection = { version: 1, programs: [one, other], activeProgramId: one.id };
  const original = structuredClone(collection);
  const result = projectProgramFocus(collection);
  assert.equal(result.current, one);
  assert.equal(result.globalFocus?.program, other);
  assert.equal(result.globalFocus?.focus, other.focus);
  assert.deepEqual(collection, original);
});

test("W1 malformed references are not guessed from unrelated programs", () => {
  const other = example("other");
  const collection: ProgramCollection = { version: 1, programs: [other], activeProgramId: "missing" };
  assert.equal(projectProgramFocus(collection).current, null);
  assert.equal(projectProgramFocus(collection).globalFocus, null);
});
