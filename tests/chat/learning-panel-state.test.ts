import assert from "node:assert/strict";
import test from "node:test";
import { projectLearningPanel } from "../../src/chat/learning-panel-state";
import type { NoxProgramOverview } from "../../src/application/learning-types";

const NOW = 1_800_000_000_000;
function overview(): NoxProgramOverview {
  return {
    goal: "Learn concurrency", planVersion: 2, active: true,
    focus: { status: "active", objectiveId: "lock" },
    next: { kind: "guided-practice", objectiveId: "lock",
      reason: "Independent check", trigger: "verify-independently",
      criterionIds: ["lock@2:criterion-1"] },
    objectives: [{
      objective: { id: "lock", title: "Lock ordering", outcome: "Explain lock ordering",
        rubric: ["Explain ordering", "Show example"], prerequisiteIds: [],
        estimatedMinutes: 40, sourceRefs: ["approved.md"], priority: "core",
        objectiveRevision: 2 },
      status: "remediate", attempts: 2, dueAt: null,
      criteria: [
        { id: "lock@2:criterion-1", label: "Explain ordering", status: "assisted",
          evidenceIds: ["e1", "e2"] },
        { id: "lock@2:criterion-2", label: "Show example", status: "unknown",
          evidenceIds: [] },
      ],
    }],
  };
}
test("active objective presents single-focus actions and honest criterion statuses", () => {
  const view = projectLearningPanel(overview(), NOW);
  assert.equal(view.total, 1);
  assert.equal(view.mastered, 0);
  assert.equal(view.focus?.objectiveId, "lock");
  assert.equal(view.focus?.title, "Lock ordering");
  assert.deepEqual(view.focus?.criteria.map(c => c.status), ["assisted", "unknown"]);
  assert.deepEqual(view.focus?.actions.map(x => x.command),
    ["/next", "/pause-focus", "/end-focus"]);
  assert.equal(view.next.trigger, "verify-independently");
  assert.deepEqual(view.next.criteria, ["lock@2:criterion-1"]);
});
test("paused focus cannot offer next action or resume an unrelated objective", () => {
  const current = overview();
  current.focus = { status: "paused", objectiveId: "lock" };
  const view = projectLearningPanel(current, NOW);
  assert.deepEqual(view.focus?.actions.map(x => x.command),
    ["/resume-focus", "/end-focus"]);
});
test("absent focus does not create fictional current objective", () => {
  const current = overview();
  current.focus = undefined; current.active = false;
  const view = projectLearningPanel(current, NOW);
  assert.equal(view.focus, null);
  assert.equal(view.revision, null);
  assert.equal(view.next.objective, "Lock ordering");
});
test("pending M2 preview requires explicit approve/cancel with correct immutable operation ID", () => {
  const current = overview();
  current.active = false; current.focus = undefined;
  current.revisionPreview = {
    operationId: "a1111111-1111-4111-8111-111111111111",
    programId: "p",
    fromVersion: 2, toVersion: 3,
    reason: "repeated-prerequisite-gap", reasonEvidenceIds: ["failure-1", "failure-2"],
    expiresAt: NOW + 5000,
    before: [], after: [],
    operations: [{
      kind: "revise", objectiveId: "lock", changes: { rubric: ["Explain order independently"] },
    }],
  };
  const snapshot = structuredClone(current);
  const view = projectLearningPanel(current, NOW);
  assert.deepEqual(view.revision?.changes, ["Revise: lock (rubric)"]);
  assert.deepEqual(view.revision?.actions.map(x => x.command), [
    "/approve-replan a1111111-1111-4111-8111-111111111111",
    "/cancel-replan a1111111-1111-4111-8111-111111111111",
  ]);
  assert.deepEqual(view.revision?.evidenceIds, ["failure-1", "failure-2"]);
  assert.deepEqual(current, snapshot, "UI must not mutate the stored proposal");
});
test("expired, stale and focus-conflicting previews are not actionable", () => {
  const current = overview();
  current.active = false; current.focus = undefined;
  current.revisionPreview = {
    operationId: "a1111111-1111-4111-8111-111111111111",
    programId: "p", fromVersion: 2, toVersion: 3, reason: "goal-change",
    reasonEvidenceIds: [], expiresAt: NOW - 1, operations: [{
      kind: "deprecate", objectiveId: "old", replacementIds: ["lock"],
    }], before: [], after: [],
  };
  assert.equal(projectLearningPanel(current, NOW).revision, null);
  current.revisionPreview.expiresAt = NOW + 5000;
  current.revisionPreview.fromVersion = 1;
  assert.equal(projectLearningPanel(current, NOW).revision, null);
  current.revisionPreview.fromVersion = 2;
  current.active = true; current.focus = { status: "active", objectiveId: "lock" };
  assert.equal(projectLearningPanel(current, NOW).revision, null);
});
test("new revision changes have no fake mastery or hidden auto-apply", () => {
  const current = overview();
  current.focus = undefined; current.active = false;
  current.objectives[0].status = "unseen";
  current.objectives[0].attempts = 0;
  current.objectives[0].criteria = current.objectives[0].criteria.map(c =>
    ({ ...c, status: "unknown", evidenceIds: [] }));
  const state = projectLearningPanel(current, NOW);
  assert.equal(state.mastered, 0);
  assert.equal(state.focus, null);
  assert.equal(state.revision, null);
});
test("history evidence IDs and decision criterion IDs are bounded in the UI", () => {
  const current = overview();
  current.objectives[0].criteria[0].evidenceIds =
    Array.from({ length: 80 }, (_, i) => "e" + i);
  current.next.criterionIds = Array.from({ length: 90 }, (_, i) => "c" + i);
  const view = projectLearningPanel(current, NOW);
  assert.equal(view.focus?.criteria[0].evidenceIds.length, 4);
  assert.equal(view.next.criteria.length, 12);
});
test("view model is deterministic for the same authoritative projection", () => {
  const current = overview();
  const first = projectLearningPanel(current, NOW);
  assert.deepEqual(first, projectLearningPanel(current, NOW));
});
