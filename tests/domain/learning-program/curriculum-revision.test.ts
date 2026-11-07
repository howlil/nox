import assert from "node:assert/strict";
import test from "node:test";
import { applyCurriculumRevision, detectStructuralGap, type CurriculumRevision } from "../../../packages/core/src/domain/learning-program/curriculum-revision";
import { decodeCurriculumOperations } from "../../../packages/core/src/domain/learning-program/curriculum-revision-schema";
import { objectiveProgress } from "../../../packages/core/src/domain/learning-program/rules";
import type { LearningProgram } from "../../../src/domain/learning-program/types";
import type { LearningEvidence } from "../../../src/domain/learning-state/types";

function program(): LearningProgram {
  return { version: 2, id: "p", goal: "Learn SQL", planVersion: 1, createdAt: 1,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
      sourcePaths: [], excludedTopics: [] },
    objectives: [
      { id: "basics", title: "Basics", outcome: "Explain select",
        prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain select"],
        sourceRefs: [], priority: "core" },
      { id: "joins", title: "Joins", outcome: "Use joins",
        prerequisiteIds: ["basics"], estimatedMinutes: 30, rubric: ["Use join"],
        sourceRefs: [], priority: "core" },
    ] };
}
function proposal(operations: CurriculumRevision["operations"], overrides: Partial<CurriculumRevision> = {}): CurriculumRevision {
  return { id: "r1", operationId: "operation-1", programId: "p", baseVersion: 1,
    reason: "goal-change", reasonEvidenceIds: [], operations, ...overrides };
}
const evidence = (id: string, objectiveId: string, createdAt: number,
  outcome = "incorrect"): LearningEvidence => ({
    id, type: "practice", scope: "learner", programId: "p",
    objectiveId, concept: "SQL", source: "lesson", createdAt, outcome,
    objectiveRevision: 1, evidenceVersion: 3, questionId: id,
    assisted: false, assistance: { highestHintLevel: 0, independent: true },
    taskKind: outcome === "correct" && createdAt > 12 * 3_600_000
      ? "recall" as const : "guided-practice" as const,
    rubricResults: [{ criterion: objectiveId === "joins" ? "Use joins" : "Explain select",
      criterionId: objectiveId + "@1:criterion-1", met: outcome === "correct", evidence: "checked" }],
  });
test("adding a prerequisite preserves untouched objective revision and historic mastery evidence", () => {
  const previous = program();
  const updated = applyCurriculumRevision(previous, proposal([
    { kind: "add", objective: { id: "keys", title: "Keys", outcome: "Explain relational keys",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Identify keys"],
      sourceRefs: [], priority: "core" } },
    { kind: "change-prerequisites", objectiveId: "joins", prerequisiteIds: ["basics", "keys"] },
  ]), [], 123);
  assert.equal(updated.planVersion, 2);
  assert.equal(updated.objectives.find(o => o.id === "basics")?.objectiveRevision, 1);
  assert.equal(updated.objectives.find(o => o.id === "joins")?.objectiveRevision, 2);
  assert.equal(updated.objectives.find(o => o.id === "keys")?.objectiveRevision, 2);
  assert.equal(previous.planVersion, 1);
  const earlier = [evidence("a", "basics", 10, "correct"), evidence("b", "basics", 12 * 3_600_000 + 11, "correct")];
  assert.equal(objectiveProgress(previous, "basics", earlier).status, "mastered");
  assert.equal(objectiveProgress(updated, "basics", earlier).status, "mastered");
  assert.equal(updated.curriculumRevisions?.[0]?.reason, "goal-change");
  assert.equal(applyCurriculumRevision(updated, proposal([]), [], 124).planVersion, 2,
    "same persisted operationId cannot apply twice");
});
test("same rubric count with new objective revision does not inherit prior mastery", () => {
  const before = program();
  const earlier = [evidence("a", "basics", 10, "correct"), evidence("b", "basics", 12 * 3_600_000 + 11, "correct")];
  assert.equal(objectiveProgress(before, "basics", earlier).status, "mastered");
  const updated = applyCurriculumRevision(before, proposal([
    { kind: "revise", objectiveId: "basics", changes: { rubric: ["Describe selects"] } },
  ]), [], 123);
  assert.equal(objectiveProgress(updated, "basics", earlier).status, "unseen");
});
test("revision rejects missing references, cycles, invalid source, stale versions and active focus", () => {
  assert.throws(() => applyCurriculumRevision(program(), proposal([
    { kind: "change-prerequisites", objectiveId: "basics", prerequisiteIds: ["joins"] },
  ]), [], 100), /cycle/);
  assert.throws(() => applyCurriculumRevision(program(), proposal([
    { kind: "change-prerequisites", objectiveId: "joins", prerequisiteIds: ["missing"] },
  ]), [], 100), /Unknown prerequisite/);
  const restricted = program();
  restricted.constraints = { ...restricted.constraints, sourceBound: true, sourcePaths: ["approved.md"] };
  restricted.objectives = restricted.objectives.map(o => ({ ...o, sourceRefs: ["approved.md"] }));
  assert.throws(() => applyCurriculumRevision(restricted, proposal([
    { kind: "add", objective: { id: "a", title: "New", outcome: "Learn unapproved facts",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Know something"],
      sourceRefs: ["bad.md"], priority: "core" } },
  ]), [], 100), /unapproved|source/);
});
test("deprecation retains historical objective and rejects live dependents", () => {
  const original = program();
  assert.throws(() => applyCurriculumRevision(original, proposal([
    { kind: "deprecate", objectiveId: "basics", replacementIds: ["joins"] },
  ]), [], 10), /deprecated prerequisites/);
  const updated = applyCurriculumRevision(original, proposal([
    { kind: "deprecate", objectiveId: "joins", replacementIds: ["basics"] },
  ]), [], 10);
  assert.equal(updated.objectives.length, 2);
  assert.equal(updated.objectives[1].deprecated, true);
  assert.deepEqual(updated.objectives[1].replacementIds, ["basics"]);
});
test("structural trigger requires grounded evidence from the same program", () => {
  const before = program();
  const observations = [evidence("one", "joins", 100), evidence("two", "joins", 200), evidence("three", "joins", 300)];
  assert.deepEqual(detectStructuralGap(before, observations), {
    reason: "repeated-prerequisite-gap", objectiveId: "joins",
    evidenceIds: ["one", "two", "three"],
  });
  const rev = proposal([{ kind: "revise", objectiveId: "joins", changes: { outcome: "Use SQL joins independently" } }],
    { reason: "repeated-prerequisite-gap", reasonEvidenceIds: ["one", "two", "three"] });
  const updated = applyCurriculumRevision(before, rev, observations, 400);
  assert.equal(updated.planVersion, 2);
  assert.equal(detectStructuralGap(updated, observations), null, "consumed evidence is revision-scoped");
  assert.throws(() => applyCurriculumRevision(before, { ...rev, reasonEvidenceIds: ["invented"] }, observations, 400), /unknown/);
  assert.throws(() => applyCurriculumRevision(before, { ...rev, baseVersion: 2 }, observations, 400), /version conflict/);
  assert.throws(() => applyCurriculumRevision({ ...before, focus: {
    id: "f", programId: "p", objectiveId: "joins", curriculumRevision: 1,
    chatSessionId: "chat", status: "paused", startedAt: 5,
  } }, rev, observations, 400), /End the existing objective focus/);
});
test("decoder rejects untrusted authority fields and malformed operations", () => {
  const valid = decodeCurriculumOperations({ kind: "curriculum-revision", operations: [
    { kind: "change-prerequisites", objectiveId: "joins", prerequisiteIds: ["basics"] },
  ] });
  assert.equal(valid.length, 1);
  assert.throws(() => decodeCurriculumOperations({ kind: "curriculum-revision", operations: [
    { kind: "revise", objectiveId: "joins", changes: { objectiveRevision: 9999 } },
  ] }), /unauthorized/);
  assert.throws(() => decodeCurriculumOperations({ kind: "curriculum-revision", operations: [
    { kind: "add", objective: { id: "new", title: "New", outcome: "Test",
      prerequisiteIds: [], estimatedMinutes: 10, rubric: ["Test"], sourceRefs: [],
      priority: "core", hiddenAuthority: true } },
  ] }), /unauthorized/);
});

test("unversioned attempts and single-item MCQ never trigger prior mastery", () => {
  const p = program();
  const mcq = [evidence("mcq-a", "basics", 100, "correct"),
    evidence("mcq-b", "basics", 200, "correct")]
    .map(item => ({ ...item, assessmentCoverage: "single-item" as const, taskKind: "diagnostic" as const }));
  assert.equal(detectStructuralGap(p, mcq), null);
  const withoutQuestion = mcq.map(item => ({ ...item, questionId: undefined,
    assessmentCoverage: undefined }));
  assert.equal(detectStructuralGap(p, withoutQuestion), null);
  const stale = [evidence("old-a", "basics", 100, "correct"),
    evidence("old-b", "basics", 200, "correct")]
    .map(item => ({ ...item, objectiveRevision: 999, taskKind: "diagnostic" as const }));
  assert.equal(detectStructuralGap(p, stale), null);
});

test("complete independent diagnostics can open prior-mastery structural review", () => {
  const p = program();
  const diagnostic = [evidence("d1", "basics", 100, "correct"),
    evidence("d2", "basics", 200, "correct")]
    .map(item => ({ ...item, taskKind: "diagnostic" as const }));
  assert.deepEqual(detectStructuralGap(p, diagnostic), {
    reason: "unexpected-prior-mastery", objectiveId: "basics", evidenceIds: ["d1", "d2"],
  });
});

test("R3 revert creates a new version, retains the previous graph and never deletes nodes", () => {
  const before = program();
  const changed = applyCurriculumRevision(before, proposal([{
    kind: "add", objective: { id: "extra", title: "Extra", outcome: "Explain extras",
      rubric: ["Explain"], estimatedMinutes: 20, prerequisiteIds: [],
      sourceRefs: [], priority: "supporting" },
  }]), [], 100);
  const undo: CurriculumRevision = {
    id: "revert", operationId: "undo", programId: "p", baseVersion: 2,
    reason: "goal-change", reasonEvidenceIds: [],
    operations: [{ kind: "revert", targetOperationId: "operation-1" }],
  };
  const restored = applyCurriculumRevision(changed, undo, [], 200);
  assert.equal(restored.planVersion, 3);
  assert.equal(restored.objectives.find(o => o.id === "extra")?.deprecated, true);
  assert.equal(restored.objectives.length, 3);
  assert.equal(restored.curriculumRevisions?.length, 2);
  assert.equal(applyCurriculumRevision(restored, undo, [], 300).planVersion, 3);
});
