import assert from "node:assert/strict";
import test from "node:test";
import { captureLearningAuthority, assertLearningAuthority } from "../../src/application/learning-authority";
import type { LearningProgram, ProgramCollection } from "../../src/domain/learning-program/types";
import type { LearningEvidence } from "../../src/domain/learning-state/types";

const program = (): LearningProgram => ({
  version: 1, id: "p", goal: "Learn databases", planVersion: 2, createdAt: 1,
  constraints: { sourcePaths: [], sourceBound: false, excludedTopics: [],
    minutesPerSession: 45, sessionsPerWeek: 3 },
  objectives: [{ id: "tx", title: "Transactions", outcome: "Explain ACID",
    estimatedMinutes: 30, priority: "core", rubric: ["Explain atomicity"],
    criteria: [{ id: "c1", description: "Explain atomicity", required: true }],
    sourceRefs: [], prerequisiteIds: [] }],
  focus: { id: "focus-1", programId: "p", objectiveId: "tx",
    status: "active", startedAt: 100, curriculumRevision: 2, chatSessionId: "chat-1" },
});
const collection = (p: LearningProgram): ProgramCollection =>
  ({ version: 1, activeProgramId: "p", programs: [p] });
const entry: LearningEvidence = {
  id: "one", type: "practice", scope: "learner", programId: "p", objectiveId: "tx",
  questionId: "q1", createdAt: 1000, concept: "ACID", source: "session",
  outcome: "incorrect", objectiveRevision: 2,
  rubricResults: [{ criterion: "Explain atomicity", criterionId: "c1",
    met: false, evidence: "Missing detail" }],
};
test("authority snapshot rejects a changed program, revision, focus, owner, question and evidence", () => {
  const p = program();
  const snapshot = captureLearningAuthority(p, "tx", "chat-1", [entry]);
  assertLearningAuthority(snapshot, collection(p), [entry], "chat-1", "tx");
  assert.throws(() => assertLearningAuthority(snapshot, collection(p), [entry],
    "other-chat", "tx"), /identity/);
  assert.throws(() => assertLearningAuthority(snapshot, collection(p), [entry],
    "chat-1", "other"), /identity/);
  assert.throws(() => assertLearningAuthority(snapshot,
    { ...collection(p), activeProgramId: "other" }, [entry], "chat-1", "tx"), /identity/);
  assert.throws(() => assertLearningAuthority(snapshot, collection({
    ...p, planVersion: 3,
  }), [entry], "chat-1", "tx"), /Curriculum/);
  for (const focus of [{ ...p.focus!, status: "paused" as const },
    { ...p.focus!, id: "focus-2" },
    { ...p.focus!, chatSessionId: "chat-2" }]) {
    assert.throws(() => assertLearningAuthority(snapshot, collection({
      ...p, focus,
    }), [entry], "chat-1", "tx"), /focus or learning session/);
  }
  assert.throws(() => assertLearningAuthority(snapshot, collection(p),
    [...[entry], { ...entry, id: "two" }], "chat-1", "tx"), /evidence changed/);
  assert.throws(() => assertLearningAuthority(snapshot, collection({
    ...p, session: { startedAt: 333, timeBudgetMinutes: 45 },
  }), [entry], "chat-1", "tx"), /learning session/);
});
test("failed focus authorization cannot be captured and changed gap status invalidates snapshot", () => {
  const p = program();
  assert.throws(() => captureLearningAuthority({
    ...p, focus: { ...p.focus!, status: "paused" },
  }, "tx", "chat-1", []), /does not authorize/);
  assert.throws(() => captureLearningAuthority(p, "tx", "other", []), /does not authorize/);
  const open = [{ id: "gap", concept: "ACID", reason: "Missing",
    evidenceIds: ["one"], programId: "p", objectiveId: "tx", status: "open" as const }];
  const snapshot = captureLearningAuthority(p, "tx", "chat-1", [entry], open);
  assert.throws(() => assertLearningAuthority(snapshot, collection(p), [entry],
    "chat-1", "tx", [{ ...open[0], status: "resolved" }]), /evidence changed/);
});
test("free session is valid only until it is replaced or a focus is opened", () => {
  const p = { ...program(), focus: undefined,
    session: { startedAt: 200, timeBudgetMinutes: 45 } };
  const snapshot = captureLearningAuthority(p, "tx", "chat-1", []);
  assertLearningAuthority(snapshot, collection(p), [], "chat-1", "tx");
  assert.throws(() => assertLearningAuthority(snapshot, collection({
    ...p, focus: program().focus,
  }), [], "chat-1", "tx"), /focus/);
});
