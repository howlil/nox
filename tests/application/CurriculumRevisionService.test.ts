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

test("source-bound M2 provider receives only explicitly approved note text", async () => {
  let saved: ProgramCollection = { version: 2, activeProgramId: "program-m2", programs: [program()] };
  saved.programs[0].constraints = { ...saved.programs[0].constraints,
    sourceBound: true, sourcePaths: ["approved.md"] };
  saved.programs[0].objectives = saved.programs[0].objectives.map(o =>
    ({ ...o, sourceRefs: ["approved.md"] }));
  let called = 0;
  const runtime = { supportsSourceIsolation: () => true, send: async function* ({ prompt }: { prompt: string }) {
    called++;
    assert.match(prompt, /approved.md/);
    assert.match(prompt, /SELECT is a query/);
    assert.ok(!prompt.includes("private-secret.md"));
    yield { type: "text", content: "```curriculum-revision\n" + JSON.stringify({
      kind: "curriculum-revision", operations: [{
        kind: "revise", objectiveId: "joins", changes: {
          outcome: "Use joins with a primary key", sourceRefs: ["approved.md"],
        },
      }],
    }) + "\n```" };
    yield { type: "completed" };
  } };
  const contexts = { resolve: async (refs: unknown) => {
    assert.deepEqual(refs, [{ kind: "vault-note", path: "approved.md" }]);
    return { explicit: [{ type: "note", source: "explicit", path: "approved.md",
      content: "SELECT is a query." }], activeNote: {
        path: "private-secret.md", content: "Do not send these private secrets.",
      } };
  } };
  const rig = new LearningProgramOrchestrator(runtime as never, contexts as never,
    { load: async () => ({ evidence: [] }) } as never,
    { load: async () => structuredClone(saved),
      save: async (next: ProgramCollection) => { saved = structuredClone(next); } } as never,
    () => undefined, () => "chatgpt", () => 2000);
  const preview = await rig.prepareCurriculumRevision("goal-change");
  assert.equal(preview.after.find(o => o.id === "joins")?.outcome, "Use joins with a primary key");
  assert.equal(called, 1);
  assert.equal(saved.programs[0].planVersion, 1, "preview is not persistence");
  rig.dispose();
});

test("source-bound M2 fails closed if an approved source is missing", async () => {
  const saved: ProgramCollection = { version: 2, activeProgramId: "program-m2", programs: [program()] };
  saved.programs[0].constraints.sourceBound = true;
  saved.programs[0].constraints.sourcePaths = ["approved.md"];
  let agentCalls = 0;
  const rig = new LearningProgramOrchestrator({
    supportsSourceIsolation: () => true,
    send: async function* () { agentCalls++; yield { type: "completed" }; },
  } as never, { resolve: async () => ({ explicit: [], activeNote: {
    path: "not-approved.md", content: "Off-scope note",
  } }) } as never, { load: async () => ({ evidence: [] }) } as never,
  { load: async () => structuredClone(saved), save: async () => {} } as never,
  () => undefined, () => "chatgpt", () => 2000);
  await assert.rejects(rig.prepareCurriculumRevision("goal-change"),
    /Approved source note could not be resolved/);
  assert.equal(agentCalls, 0);
  rig.dispose();
});

test("R4 unisolated CLI-like runtime is denied before source reads and provider inference", async () => {
  const original = program();
  original.constraints = { ...original.constraints, sourceBound: true,
    sourcePaths: ["approved.md"] };
  let reads = 0, calls = 0;
  const orchestrator = new LearningProgramOrchestrator({
    supportsSourceIsolation: () => false,
    send: async function* () { calls++; yield { type: "completed" }; },
  } as never, { resolve: async () => { reads++; return { explicit: [] }; } } as never,
    { load: async () => ({ evidence: [] }) } as never,
    { load: async () => ({ version: 2, activeProgramId: original.id,
      programs: [structuredClone(original)] }) } as never,
    () => undefined, () => "agy", () => 2000);
  await assert.rejects(orchestrator.prepareCurriculumRevision("goal-change"),
    /isolated provider/);
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  orchestrator.dispose();
});
