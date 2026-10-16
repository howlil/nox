import assert from "node:assert/strict";
import test from "node:test";
import { applyStructuralRevision, previewStructuralRevision,
  type StructuralRevisionProposal } from "../../../src/domain/learning-program/structural-revision";
import type { LearningProgram } from "../../../src/domain/learning-program/types";
import { chooseNextActivity, validateCurriculum } from "../../../src/domain/learning-program/rules";
import { estimateRemainingWork } from "../../../src/domain/learning-program/estimate";

const program: LearningProgram = {
  version: 1, id: "prog", goal: "Build reliable systems", createdAt: 100,
  planVersion: 1, constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false, sourcePaths: [], excludedTopics: [] },
  objectives: validateCurriculum({ kind: "curriculum", objectives: [
    { id: "basics", title: "Basics", outcome: "Explain system boundaries",
      prerequisiteIds: [], estimatedMinutes: 30,
      rubric: ["Explain boundaries"], sourceRefs: [], priority: "core" },
    { id: "advanced", title: "Advanced", outcome: "Compose systems",
      prerequisiteIds: ["basics"], estimatedMinutes: 60,
      rubric: ["Design isolation"], sourceRefs: [], priority: "core" },
  ] }, { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
    sourcePaths: [], excludedTopics: [] }).objectives,
};
const proposal = (action: StructuralRevisionProposal["action"],
  id = "manual:one"): StructuralRevisionProposal => ({
  operationId: id, programId: program.id, baseVersion: 1,
  rationale: "Learner explicitly requested a safer progression",
  action,
});

test("revise previews only whitelisted metadata, then commits stable rubric and identity", () => {
  const request = proposal({ kind: "revise", objectiveId: "basics",
    changes: { title: "Systems foundation", estimatedMinutes: 40 } });
  const before = structuredClone(program);
  const diff = previewStructuralRevision(program, request);
  assert.deepEqual(diff.changedFields, ["title", "estimatedMinutes"]);
  assert.deepEqual(program, before, "preview is pure");
  const revised = applyStructuralRevision(program, request);
  assert.equal(revised.planVersion, 2);
  assert.equal(revised.objectives[0].title, "Systems foundation");
  assert.deepEqual(revised.objectives[0].criteria, program.objectives[0].criteria);
  assert.deepEqual(revised.curriculumRevisions?.[0].before, program.objectives[0]);
  assert.deepEqual(revised.curriculumRevisions?.[0].after, revised.objectives[0]);
  assert.equal(applyStructuralRevision(revised, request), revised);
  assert.deepEqual(program, before, "evidence and original program remain unchanged");
  assert.throws(() => applyStructuralRevision(program,
    { ...request, baseVersion: 2 }), /version conflict/);
  assert.throws(() => previewStructuralRevision(program,
    proposal({ kind: "revise", objectiveId: "basics",
      changes: { rubric: ["Different skill"] } } as never)), /non-rubric/);
});

test("prerequisite rewiring prevents cycles, missing IDs, and self-dependency", () => {
  const request = proposal({ kind: "change-prerequisites",
    objectiveId: "advanced", prerequisiteIds: [] });
  const revised = applyStructuralRevision(program, request);
  assert.deepEqual(revised.objectives[1].prerequisiteIds, []);
  assert.throws(() => previewStructuralRevision(program, proposal({
    kind: "change-prerequisites", objectiveId: "basics", prerequisiteIds: ["advanced"],
  })), /cycle/);
  assert.throws(() => previewStructuralRevision(program, proposal({
    kind: "change-prerequisites", objectiveId: "advanced", prerequisiteIds: ["missing"],
  })), /unique, existing and active/);
  assert.throws(() => previewStructuralRevision(program, proposal({
    kind: "change-prerequisites", objectiveId: "basics", prerequisiteIds: ["basics"],
  })), /itself/);
});

test("deprecating a referenced objective requires rewiring first, retains tombstone", () => {
  assert.throws(() => previewStructuralRevision(program, proposal({
    kind: "deprecate", objectiveId: "basics",
  })), /Rewire dependent/);
  const detached = applyStructuralRevision(program, proposal({
    kind: "change-prerequisites", objectiveId: "advanced", prerequisiteIds: [],
  }));
  const drop = { operationId: "manual:two", programId: detached.id,
    baseVersion: detached.planVersion, rationale: "Retire outdated learning task",
    action: { kind: "deprecate" as const, objectiveId: "basics" } };
  const retired = applyStructuralRevision(detached, drop);
  assert.equal(retired.objectives.length, 2);
  assert.equal(retired.objectives[0].deprecated, true);
  assert.equal(chooseNextActivity(retired, []).objective?.id, "advanced");
  assert.ok(estimateRemainingWork(retired, []).minutes < estimateRemainingWork(program, []).minutes);
  assert.throws(() => previewStructuralRevision(retired, {
    ...drop, baseVersion: retired.planVersion, operationId: "manual:three",
  }), /deprecated/);
});

test("structural approval rejects wrong program, focus, invalid rationale, no-op and stale plan", () => {
  const req = proposal({ kind: "revise", objectiveId: "basics",
    changes: { title: "Foundation" } });
  assert.throws(() => previewStructuralRevision(program, {
    ...req, programId: "other",
  }), /different program/);
  assert.throws(() => previewStructuralRevision(program, {
    ...req, rationale: "short",
  }), /rationale/);
  assert.throws(() => previewStructuralRevision(program, {
    ...req, action: { kind: "revise", objectiveId: "basics", changes: { title: "Basics" } },
  }), /no effective changes/);
  assert.throws(() => previewStructuralRevision({ ...program,
    focus: { id: "f", programId: "prog", objectiveId: "basics",
      curriculumRevision: 1, status: "paused", startedAt: 100 } }, req), /End the active or paused focus/);
});
