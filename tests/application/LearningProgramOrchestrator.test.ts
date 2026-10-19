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
  let currentTime = Date.now();
  let stored: ProgramCollection = { version: 1, programs: [] };
  let writes = 0;
  let reads = 0;
  const context = { activeNote: { path: "notes/spanish.md", content: "Hola means hello." }, explicit: [] };
  const runtime = {
    supportsSourceIsolation: () => true,
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
    { load: async () => { reads++; return structuredClone(stored); },
      save: async (next: ProgramCollection, expected: ProgramCollection) => {
        assert.notStrictEqual(next, expected, "Never mutate the expected loaded CAS snapshot");
        assert.deepEqual(expected, stored, "Expected CAS bytes must match the authoritative previous state");
        stored = structuredClone(next);
        writes++;
      } } as never,
    () => undefined,
    () => "chatgpt",
    () => currentTime,
  );
  return { orchestrator, stored: () => structuredClone(stored), writes: () => writes,
    reads: () => reads,
    advance: (ms: number) => { currentTime += ms; } };
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

test("repeated creation operation is idempotent after the program was persisted", async () => {
  const { orchestrator, stored, writes } = rig();
  const first = await orchestrator.createProgram("Spanish", base, "create:one");
  const second = await orchestrator.createProgram("Spanish", base, "create:one");
  assert.equal(first.id, second.id);
  assert.equal(stored().programs.length, 1);
  assert.equal(writes(), 1);
});
test("timeboxed sessions require explicit extension and have a durable ledger", async () => {
  const { orchestrator, stored } = rig();
  await orchestrator.createProgram("Spanish", base);
  await orchestrator.startSession();
  await assert.rejects(orchestrator.startSession(), /already active/);
  const extended = await orchestrator.extendSession(15);
  assert.equal(extended.session?.timeBudgetMinutes, 60);
  await assert.rejects(orchestrator.extendSession(200), /240/);
  await orchestrator.endSession();
  assert.equal(stored().programs[0].session, undefined);
  assert.equal(stored().programs[0].sessionHistory?.length, 1);
  await assert.rejects(orchestrator.endSession(), /No active session/);
});
test("teaching markers are idempotent and apply to the matching objective", async () => {
  const { orchestrator, stored } = rig();
  await orchestrator.createProgram("Spanish", base);
  await orchestrator.markTaught("basic", 1000);
  await orchestrator.markTaught("basic", 1000);
  assert.equal(stored().programs[0].instructionEvents?.length, 1);
  await assert.rejects(orchestrator.markTaught("unknown", 1000), /unknown/);
});

test("active budget excludes AI requests and survives crash-style recovery", async () => {
  const { orchestrator, advance } = rig();
  await orchestrator.createProgram("SQL practice", base);
  await orchestrator.startSession();

  advance(30_000);
  await orchestrator.flushTime();
  assert.equal((await orchestrator.getSessionTime())?.activeMs, 30_000);

  assert.equal(await orchestrator.beginAiWait("run-one"), true);
  advance(30_000);
  await orchestrator.flushTime();
  await orchestrator.finishAiWait("run-one");
  assert.equal((await orchestrator.getSessionTime())?.aiWaitingMs, 30_000);
  assert.equal((await orchestrator.getSessionTime())?.remainingMs, 44 * 60_000 + 30_000);

  await orchestrator.recoverSessions();
  advance(180_000);
  assert.equal((await orchestrator.getSessionTime())?.status, "recovered");
  assert.equal((await orchestrator.getSessionTime())?.remainingMs, 44 * 60_000 + 30_000);
  await orchestrator.resumeSession();
  await orchestrator.endSession();
  orchestrator.dispose();
});

test("session mutations serialize full read-modify-write and keep pause reasons", async () => {
  const { orchestrator, stored } = rig();
  await orchestrator.createProgram("SQL practice", base);
  await orchestrator.startSession();
  await Promise.all([
    orchestrator.extendSession(15),
    orchestrator.focusObjective("basic"),
    orchestrator.pauseSession(),
  ]);
  const session = stored().programs[0].session;
  assert.equal(session?.timeBudgetMinutes, 60);
  assert.equal(session?.timing?.focusObjectiveId, "basic");
  assert.deepEqual(session?.timing?.pauseReasons, ["manual"]);
  await orchestrator.endSession();
  orchestrator.dispose();
});

test("preview never persists before approval; repeated commit uses one operation ID", async () => {
  const { orchestrator, stored, writes } = rig();
  const pending = await orchestrator.prepareProgram("Learn conversational Spanish", base);
  assert.equal(writes(), 0);
  assert.equal(stored().programs.length, 0);
  const approved = await orchestrator.commitPrepared(pending.id, "onboarding:1", true);
  const repeated = await orchestrator.commitPrepared(pending.id, "onboarding:1", true);
  assert.equal(approved.id, repeated.id);
  assert.equal(approved.workspaceApproved, true);
  assert.equal(writes(), 1);
  assert.equal(stored().programs.length, 1);
  orchestrator.dispose();
});
test("cancelled or invalid preview never writes a program", async () => {
  const { orchestrator, writes } = rig({ kind: "curriculum", objectives: [] });
  await assert.rejects(orchestrator.prepareProgram("Learn something", base), /1–60/);
  assert.equal(writes(), 0);
});

test("objective focus lifecycle persists without a timed session and resumes only in owning chat", async () => {
  const { orchestrator, stored } = rig();
  await orchestrator.createProgram("Spanish", base);
  await assert.rejects(orchestrator.startFocus("apply", "chat-a"), /Prerequisites/);
  const focused = await orchestrator.startFocus("basic", "chat-a");
  assert.equal(focused.session, undefined);
  assert.equal(focused.focus?.objectiveId, "basic");
  assert.equal((await orchestrator.getDecision())?.decision.kind, "diagnostic");
  await assert.rejects(orchestrator.startFocus("basic", "chat-a"), /End the existing/);
  await assert.rejects(orchestrator.prepareProgram("Other", base), /Pause or end/);
  await orchestrator.recoverSessions();
  assert.equal(stored().programs[0].focus?.status, "paused");
  await assert.rejects(orchestrator.resumeFocus("chat-b"), /original chat/);
  await orchestrator.resumeFocus("chat-a");
  assert.equal(stored().programs[0].focus?.id, focused.focus?.id);
  await orchestrator.pauseFocus();
  await orchestrator.endFocus();
  assert.equal(stored().programs[0].focus, undefined);
  orchestrator.dispose();
});

test("concurrent session, focus and rename mutations never lose updates", async () => {
  const { orchestrator, stored } = rig();
  await orchestrator.createProgram("Learn Spanish", base);
  await orchestrator.startSession();
  await Promise.all([
    orchestrator.focusObjective("basic"),
    orchestrator.extendSession(15),
    orchestrator.pauseSession(),
    orchestrator.renameMaterial("notes/spanish.md", "notes/moved.md"),
  ]);
  const persisted = stored().programs[0];
  assert.equal(persisted.session?.timeBudgetMinutes, 60);
  assert.equal(persisted.session?.timing?.focusObjectiveId, "basic");
  assert.equal(persisted.session?.timing?.focusMaterialPath, "notes/moved.md");
  assert.deepEqual(persisted.session?.timing?.pauseReasons, ["manual"]);
  await orchestrator.endSession();
  orchestrator.dispose();
});

test("queued mutation failure does not block the next successful transition", async () => {
  const { orchestrator } = rig();
  await orchestrator.createProgram("Learn Spanish", base);
  await orchestrator.startSession();
  const [invalid, valid] = await Promise.allSettled([
    orchestrator.extendSession(300),
    orchestrator.focusObjective("basic"),
  ]);
  assert.equal(invalid.status, "rejected");
  assert.equal(valid.status, "fulfilled");
  assert.equal((await orchestrator.getActiveProgram())?.session?.timing?.focusObjectiveId, "basic");
  await orchestrator.endSession();
  orchestrator.dispose();
});

test("recovery and other queued mutations preserve immutable loaded snapshots", async () => {
  const { orchestrator, stored } = rig();
  await orchestrator.createProgram("Learn Spanish", base);
  await orchestrator.startFocus("basic", "chat-a");
  await orchestrator.startSession();
  await orchestrator.recoverSessions();
  assert.equal(stored().programs[0].focus?.status, "paused");
  assert.deepEqual(stored().programs[0].session?.timing?.pauseReasons, ["recovery"]);
  orchestrator.dispose();
});

test("W1 one authoritative preflight read yields active + global focus without duplicated vault loads", async () => {
  const h = rig();
  await h.orchestrator.createProgram("Spanish", base);
  const before = h.reads();
  const snapshot = await h.orchestrator.getTurnFocusSnapshot();
  assert.equal(h.reads() - before, 1);
  assert.equal(snapshot.current?.id, h.stored().activeProgramId);
  assert.equal(snapshot.globalFocus, null);
  await h.orchestrator.startSession();
  const withSession = (await h.orchestrator.getTurnFocusSnapshot()).current;
  const beforeProjection = h.reads();
  const time = await h.orchestrator.getSessionTime(withSession);
  assert.ok(time?.budgetMs);
  assert.equal(h.reads(), beforeProjection, "projecting a known collection must not reload vault");
  h.orchestrator.dispose();
});
