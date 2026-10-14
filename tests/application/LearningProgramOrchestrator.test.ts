import assert from "node:assert/strict";
import test from "node:test";
import { LearningProgramOrchestrator } from "../../src/application/LearningProgramOrchestrator";
import type { ProgramCollection, ProgramConstraints } from "../../src/domain/learning-program/types";

const base: ProgramConstraints = {
  minutesPerSession: 45, sessionsPerWeek: 3,
  sourcePaths: [], sourceBound: false, excludedTopics: [],
};
const draft = (refs: string[] = []) => ({
  kind: "curriculum",
  objectives: [
    { id: "basic", title: "Vocabulary", outcome: "Recall basic phrases",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Recall independently"],
      sourceRefs: refs, priority: "core" },
    { id: "apply", title: "Dialogue", outcome: "Use phrases in dialogue",
      prerequisiteIds: ["basic"], estimatedMinutes: 40,
      rubric: ["Respond in context"], sourceRefs: refs, priority: "core" },
  ],
});
function rig(payload: unknown = draft(), success = true) {
  let stored: ProgramCollection = { version: 1, programs: [] };
  let writes = 0;
  const context = { activeNote: { path: "notes/spanish.md", content: "Hola means hello." }, explicit: [] };
  const runtime = {
    send: async function* () {
      yield { type: "text", content: "```learning-program\n" +
        JSON.stringify(payload) + "\n```" };
      yield success ? { type: "completed" } :
        { type: "failed", failure: { code: "process-failed", message: "crash" } };
    },
  };
  const orchestrator = new LearningProgramOrchestrator(
    runtime as never,
    { resolve: async () => context } as never,
    { load: async () => ({ evidence: [] }) } as never,
    { load: async () => structuredClone(stored),
      save: async (next: ProgramCollection) => { stored = structuredClone(next); writes++; } } as never,
    () => undefined,
  );
  return { orchestrator, stored: () => structuredClone(stored), writes: () => writes };
}
test("plan creation persists validated objectives, updates active identity and feasibility", async () => {
  const { orchestrator, stored, writes } = rig();
  const program = await orchestrator.createProgram("Speak Spanish for travel", base);
  assert.equal(program.objectives.length, 2);
  assert.equal(program.constraints.deadline, undefined);
  assert.equal(stored().activeProgramId, program.id);
  assert.equal(writes(), 1);
  await orchestrator.startSession();
  const selected = await orchestrator.getDecision();
  assert.equal(selected?.decision.kind, "diagnostic");
  assert.equal(selected?.decision.objective?.id, "basic");
  await orchestrator.endSession();
  assert.equal((await orchestrator.getActiveProgram())?.session, undefined);
});
test("source-limited planning resolves and permits only the active note", async () => {
  const { orchestrator } = rig(draft(["notes/spanish.md"]));
  const p = await orchestrator.createProgram("Learn note", { ...base, sourceBound: true });
  assert.deepEqual(p.constraints.sourcePaths, ["notes/spanish.md"]);
  const { orchestrator: bad, writes } = rig(draft(["not-selected.md"]));
  await assert.rejects(bad.createProgram("Learn note", { ...base, sourceBound: true }), /unapproved/);
  assert.equal(writes(), 0);
});
test("bad provider output and failed runtime never create a program", async () => {
  const { orchestrator: invalid, writes } = rig({ kind: "curriculum", objectives: [] });
  await assert.rejects(invalid.createProgram("Bad", base), /1–60/);
  assert.equal(writes(), 0);
  const { orchestrator: failed, writes: failedWrites } = rig(draft(), false);
  await assert.rejects(failed.createProgram("Bad", base), /crash/);
  assert.equal(failedWrites(), 0);
});
