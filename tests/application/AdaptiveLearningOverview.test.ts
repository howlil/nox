import assert from "node:assert/strict";
import test from "node:test";
import { LearningController } from "../../src/application/LearningController";
import type { LearningProgram } from "../../src/domain/learning-program/types";
import type { LearningState } from "../../src/domain/learning-state/types";
import type { CurriculumRevisionPreview } from "../../src/application/CurriculumRevisionService";

const NOW = Date.now();
const program = (): LearningProgram => ({
  id: "p", goal: "Learn databases", createdAt: 1, planVersion: 2, version: 2,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
    sourcePaths: [], excludedTopics: [] },
  objectives: [
    { id: "basics", title: "Database basics", outcome: "Explain transactions",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain isolation"],
      sourceRefs: [], priority: "core", objectiveRevision: 2 },
    { id: "historical", title: "Old content", outcome: "Unused",
      prerequisiteIds: [], estimatedMinutes: 20, rubric: ["Explain legacy"],
      sourceRefs: [], priority: "optional", objectiveRevision: 1, deprecated: true },
  ],
  focus: { id: "focus", programId: "p", objectiveId: "basics",
    chatSessionId: "chat", curriculumRevision: 2, status: "active", startedAt: 10 },
});
function harness(p: LearningProgram | null, state: LearningState, preview?: CurriculumRevisionPreview) {
  return new LearningController(
    {} as never, {} as never, {} as never, {} as never, {} as never,
    { load: async () => structuredClone(state), save: async () => {} } as never,
    {}, {
      getActiveProgram: async () => p ? structuredClone(p) : null,
      peekCurriculumRevision: () => preview,
      getSessionTime: async () => null,
    } as never,
  );
}

test("M6 overview reads current revision evidence and never invents rubric mastery", async () => {
  const older = { id: "old", type: "practice" as const, scope: "learner" as const,
    programId: "p", objectiveId: "basics", questionId: "q-old", evidenceVersion: 3 as const,
    objectiveRevision: 1, concept: "Databases", source: "old.md",
    createdAt: NOW - 86_400_000, outcome: "correct",
    assistance: { independent: true, highestHintLevel: 0 as const },
    rubricResults: [{ criterion: "Explain isolation", criterionId: "basics@1:criterion-1",
      met: true, evidence: "historical" }] };
  const controller = harness(program(), { version: 3, target: null,
    gaps: [], evidence: [older] });
  const result = await controller.getProgramOverview();
  assert.equal(result?.objectives.length, 1, "deprecated objective excluded");
  assert.equal(result?.objectives[0].status, "unseen");
  assert.equal(result?.objectives[0].attempts, 0);
  assert.equal(result?.objectives[0].criteria[0].status, "unknown");
  assert.equal(result?.next.kind, "diagnostic");
  assert.equal(result?.focus?.objectiveId, "basics");
});

test("M6 overview exposes criterion-level source evidence but no inferred personality", async () => {
  const event = { id: "current", type: "practice" as const, scope: "learner" as const,
    programId: "p", objectiveId: "basics", questionId: "q-current", evidenceVersion: 3 as const,
    objectiveRevision: 2, concept: "Database basics", source: "lesson.md",
    createdAt: NOW - 60_000, outcome: "correct", assisted: true,
    assistance: { independent: false, highestHintLevel: 1 as const },
    rubricResults: [{ criterion: "Explain isolation", criterionId: "basics@2:criterion-1",
      met: true, evidence: "hinted" }] };
  const controller = harness(program(), { version: 3, target: null, gaps: [], evidence: [event] });
  const overview = await controller.getProgramOverview();
  assert.equal(overview?.objectives[0].criteria[0].status, "assisted");
  assert.deepEqual(overview?.objectives[0].criteria[0].evidenceIds, ["current"]);
  assert.equal(overview?.objectives[0].status, "remediate");
  assert.equal(overview?.next.kind, "guided-practice");
  assert.equal("personality" in (overview ?? {}), false);
});

test("M6 overview is read-only and preserves M2 preview identity", async () => {
  const p = program(); p.focus = undefined;
  const preview: CurriculumRevisionPreview = {
    programId: "p", operationId: "a1111111-1111-4111-8111-111111111111",
    fromVersion: 2, toVersion: 3, reason: "goal-change",
    expiresAt: NOW + 10000, before: [], after: [],
    reasonEvidenceIds: [], operations: [{
      kind: "revise", objectiveId: "basics", changes: { outcome: "Explain durable transactions" },
    }],
  };
  const before = structuredClone(p);
  const controller = harness(p, { version: 3, target: null, gaps: [], evidence: [] }, preview);
  const overview = await controller.getProgramOverview();
  assert.equal(overview?.revisionPreview?.operationId, preview.operationId);
  assert.equal(overview?.planVersion, 2);
  assert.deepEqual(p, before);
  assert.equal(await harness(null, { version: 3, target: null, gaps: [], evidence: [] })
    .getProgramOverview(), null);
});
