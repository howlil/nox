import assert from "node:assert/strict";
import test from "node:test";
import { LearningProgramOrchestrator } from "../../src/application/LearningProgramOrchestrator";
import type { LearningProgram, ProgramCollection } from "../../src/domain/learning-program/types";

const program = (): LearningProgram => ({
  version: 2, id: "program-m2", goal: "SQL joins", planVersion: 1, createdAt: 1,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
    sourcePaths: [], excludedTopics: [] },
  objectives: [
    { id: "basics", title: "SQL basics", outcome: "Explain SELECT",
      prerequisiteIds: [], estimatedMinutes: 45, rubric: ["Explain SELECT"],
      sourceRefs: [], priority: "core" },
    { id: "joins", title: "SQL joins", outcome: "Write INNER JOIN",
      prerequisiteIds: ["basics"], estimatedMinutes: 40, rubric: ["Correct JOIN"],
      sourceRefs: [], priority: "core" },
  ],
});
const proposal = () => ({
  kind: "curriculum-revision",
  operations: [{
    kind: "add", objective: { id: "indexes", title: "Database indexes",
      outcome: "Explain query indexes", prerequisiteIds: ["basics"],
      estimatedMinutes: 40, rubric: ["Explain index selection"],
      sourceRefs: [], priority: "core" },
  }],
});

function harness(payload: unknown = proposal(), finish = true) {
  let saved: ProgramCollection = { version: 2, activeProgramId: "program-m2", programs: [program()] };
  let writes = 0;
  let calls = 0;
  let blocked = false;
  const runtime = { send: async function* () {
    calls++;
    yield { type: "text", content: "```curriculum-revision\n" + JSON.stringify(payload) + "\n```" };
    yield finish ? { type: "completed" } : { type: "failed", failure: { message: "provider failed" } };
  } };
  const store = {
    load: async () => structuredClone(saved),
    save: async (next: ProgramCollection, expected?: ProgramCollection) => {
      if (blocked) throw new Error("Program write conflict");
      if (expected && expected.programs[0].planVersion !== saved.programs[0].planVersion) {
        throw new Error("Program write conflict");
      }
      saved = structuredClone(next); writes++;
    },
  };
  const orchestrator = new LearningProgramOrchestrator(runtime as never,
    { resolve: async () => ({ activeNote: null, explicit: [] }) } as never,
    { load: async () => ({ evidence: [] }) } as never,
    store as never, () => undefined, () => "chatgpt", () => 1000);
  return { orchestrator, calls: () => calls, writes: () => writes, program: () => structuredClone(saved.programs[0]),
    conflict: () => { blocked = true; },
    externalChange: () => { saved.programs[0].planVersion += 1; } };
}

test("M2 model proposal is preview-only and requires explicit approval", async () => {
  const rig = harness();
  const preview = await rig.orchestrator.prepareCurriculumRevision("goal-change");
  assert.equal(rig.writes(), 0);
  assert.equal(rig.calls(), 1);
  assert.equal(preview.fromVersion, 1);
  assert.equal(preview.toVersion, 2);
  assert.equal(preview.after.some(o => o.id === "indexes"), true);
  assert.equal(rig.program().objectives.length, 2);
  const saved = await rig.orchestrator.approveCurriculumRevision(preview.operationId);
  assert.equal(saved.planVersion, 2);
  assert.equal(saved.objectives.length, 3);
  assert.equal(saved.curriculumRevisions?.length, 1);
  assert.equal(rig.writes(), 1);
  assert.equal((await rig.orchestrator.approveCurriculumRevision(preview.operationId)).planVersion, 2);
  assert.equal(rig.writes(), 1, "retry after commit is idempotent");
  rig.orchestrator.dispose();
});

test("M2 rejects obsolete optimistic plan versions before persistence", async () => {
  const rig = harness();
  const preview = await rig.orchestrator.prepareCurriculumRevision("goal-change");
  rig.externalChange();
  await assert.rejects(rig.orchestrator.approveCurriculumRevision(preview.operationId), /version conflict/);
  assert.equal(rig.writes(), 0);
  rig.orchestrator.dispose();
});

test("M2 storage conflict never publishes preview as an applied plan", async () => {
  const rig = harness();
  const preview = await rig.orchestrator.prepareCurriculumRevision("goal-change");
  rig.conflict();
  await assert.rejects(rig.orchestrator.approveCurriculumRevision(preview.operationId), /write conflict/);
  assert.equal(rig.writes(), 0);
  assert.equal(rig.program().planVersion, 1);
  rig.orchestrator.dispose();
});

test("M2 rejects provider failure, fabricated authority and malformed output without writes", async () => {
  const failed = harness(proposal(), false);
  await assert.rejects(failed.orchestrator.prepareCurriculumRevision("goal-change"), /provider failed/);
  assert.equal(failed.writes(), 0);
  failed.orchestrator.dispose();
  const extra = harness({ kind: "curriculum-revision",
    operations: [{ kind: "revise", objectiveId: "joins", changes: { planVersion: 99 } }] });
  await assert.rejects(extra.orchestrator.prepareCurriculumRevision("goal-change"), /unauthorized/);
  assert.equal(extra.writes(), 0);
  extra.orchestrator.dispose();
});

test("M2 guards active or paused focus before any model proposal", async () => {
  const rig = harness();
  const stored = await rig.orchestrator.getActiveProgram();
  assert.ok(stored);
  await rig.orchestrator.startFocus("basics", "chat-a");
  await assert.rejects(rig.orchestrator.prepareCurriculumRevision("goal-change"), /End the objective focus/);
  assert.equal(rig.calls(), 0);
  await rig.orchestrator.pauseFocus();
  await assert.rejects(rig.orchestrator.prepareCurriculumRevision("goal-change"), /End the objective focus/);
  await rig.orchestrator.endFocus();
  const preview = await rig.orchestrator.prepareCurriculumRevision("goal-change");
  assert.equal(preview.toVersion, 2);
  rig.orchestrator.dispose();
});
