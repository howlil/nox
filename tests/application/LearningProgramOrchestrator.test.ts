import assert from "node:assert/strict";
import test from "node:test";
import { LearningMutationGate } from "../../src/application/LearningMutationGate";
import { LearningProgramOrchestrator } from "../../src/application/LearningProgramOrchestrator";
import type { ProgramCollection, ProgramConstraints } from "../../src/domain/learning-program/types";
import type { KnowledgeGap, LearningEvidence } from "../../src/domain/learning-state/types";

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
function rig(payload: unknown = draft(), success = true, gate?: LearningMutationGate) {
  let currentTime = Date.now();
  let stored: ProgramCollection = { version: 1, programs: [] };
  let writes = 0;
  let failWrites = 0;
  let evidence: LearningEvidence[] = [];
  let gaps: KnowledgeGap[] = [];
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
    { load: async () => ({ evidence: structuredClone(evidence), gaps: structuredClone(gaps) }) } as never,
    { load: async () => structuredClone(stored),
      save: async (next: ProgramCollection) => {
        if (failWrites > 0) { failWrites--; throw new Error("simulated program write failure"); }
        stored = structuredClone(next); writes++;
      } } as never,
    () => undefined,
    () => "chatgpt",
    () => currentTime,
    gate,
  );
  return { orchestrator, stored: () => structuredClone(stored), writes: () => writes,
    setEvidence: (items: LearningEvidence[]) => { evidence = structuredClone(items); },
    setGaps: (items: KnowledgeGap[]) => { gaps = structuredClone(items); },
    failNextWrite: () => { failWrites++; },
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

test("persisted objective focus is self-paced, chat-owned and recovery pauses it", async () => {
  const { orchestrator, stored } = rig();
  await orchestrator.createProgram("Speak Spanish", base);
  const started = await orchestrator.startFocus("basic", "chat-first");
  assert.equal(started.focus?.objectiveId, "basic");
  assert.equal(started.focus?.chatSessionId, "chat-first");
  assert.equal(started.session, undefined);
  assert.equal((await orchestrator.getDecision())?.decision.objective?.id, "basic");
  await assert.rejects(orchestrator.startFocus("basic", "chat-second"), /already exists/);
  await assert.rejects(orchestrator.startFocus("apply"), /prerequisite/i);
  await orchestrator.recoverSessions();
  assert.equal(stored().programs[0].focus?.status, "paused");
  assert.equal((await orchestrator.getDecision())?.decision.kind, "wait");
  await orchestrator.resumeFocus();
  assert.equal(stored().programs[0].focus?.status, "active");
  await orchestrator.endFocus();
  assert.equal(stored().programs[0].focus, undefined);
  orchestrator.dispose();
});

test("structural replan stays opt-in and a paused focus blocks curriculum mutation", async () => {
  const { orchestrator } = rig();
  await orchestrator.createProgram("Speak Spanish", base);
  assert.equal(await orchestrator.replanFromEvidence(), null);
  await orchestrator.startFocus("basic", "chat-1");
  await orchestrator.pauseFocus();
  await assert.rejects(orchestrator.replanFromEvidence(), /End objective focus/);
  await orchestrator.endFocus();
  orchestrator.dispose();
});

test("onboarding approval cannot switch an active focus; paused focus may switch and later resume", async () => {
  const { orchestrator, stored } = rig();
  const original = await orchestrator.createProgram("Spanish", base);
  await orchestrator.startFocus("basic", "chat-owner");
  const prepared = await orchestrator.prepareProgram("A new skill", base);
  await assert.rejects(
    orchestrator.commitPrepared(prepared.id, "approve:other"),
    /Pause or end the active focus/,
  );
  assert.equal(stored().activeProgramId, original.id);
  assert.equal(stored().programs.length, 1);

  await orchestrator.pauseFocus();
  const created = await orchestrator.commitPrepared(prepared.id, "approve:other");
  assert.equal(stored().activeProgramId, created.id);
  assert.equal(stored().programs.find(item => item.id === original.id)?.focus?.status, "paused");
  await orchestrator.selectProgram(original.id);
  assert.equal((await orchestrator.resumeFocus()).focus?.id,
    stored().programs.find(item => item.id === original.id)?.focus?.id);
  await orchestrator.endFocus();
  orchestrator.dispose();
});

test("end-focus atomically inserts exactly one evidence-backed prerequisite after two committed errors", async () => {
  const rigged = rig();
  const { orchestrator, stored, writes, setEvidence } = rigged;
  const program = await orchestrator.createProgram("Spanish", base);
  const focused = await orchestrator.startFocus("basic", "chat-owner");
  const focusId = focused.focus!.id;
  const criterion = program.objectives.find(item => item.id === "basic")!.criteria![0];
  const failures: LearningEvidence[] = ["question-1", "question-2"].map((questionId, index) => ({
    id: "practice:" + questionId, type: "practice", scope: "learner",
    programId: program.id, objectiveId: "basic", questionId, focusSessionId: focusId,
    objectiveRevision: 1, evaluator: "llm-review",
    concept: "Vocabulary", source: "lesson.md", outcome: "incorrect",
    createdAt: 100 + index * 100,
    rubricResults: [{ criterion: criterion.description, criterionId: criterion.id,
      met: false, evidence: "Not yet recalled" }],
  }));
  setEvidence(failures);
  const beforeWrites = writes();
  const ended = await orchestrator.endFocus();
  assert.equal(writes(), beforeWrites + 1, "end and revision use a single durable program write");
  assert.equal(ended.focus, undefined);
  assert.equal(ended.planVersion, 2);
  assert.equal(ended.curriculumRevisions?.length, 1);
  assert.deepEqual(ended.curriculumRevisions?.[0].reasonEvidenceIds,
    failures.map(item => item.id));
  assert.equal(ended.objectives.length, 3);
  assert.ok(ended.objectives.find(item => item.id === "basic")?.prerequisiteIds
    .includes(ended.curriculumRevisions![0].addedObjectiveId));
  assert.equal(stored().programs[0].planVersion, 2);
  orchestrator.dispose();
});

test("no replan from legacy, foreign-focus or repaired evidence; failed save retains original focus", async () => {
  const { orchestrator, setEvidence, stored, failNextWrite } = rig();
  const program = await orchestrator.createProgram("Spanish", base);
  const started = await orchestrator.startFocus("basic", "chat-owner");
  const criterion = program.objectives[0].criteria![0];
  const sample = (id: string, focusSessionId: string): LearningEvidence => ({
    id, type: "practice", scope: "learner", programId: program.id,
    objectiveId: "basic", questionId: id, focusSessionId,
    objectiveRevision: 1, evaluator: "llm-review", concept: "Vocabulary",
    source: "notes.md", createdAt: id === "a" ? 100 : 200, outcome: "partial",
    rubricResults: [{ criterion: criterion.description, criterionId: criterion.id,
      met: false, evidence: "Incorrect" }],
  });
  setEvidence([sample("a", started.focus!.id), sample("b", "another-focus")]);
  let ended = await orchestrator.endFocus();
  assert.equal(ended.planVersion, 1);
  const focus2 = await orchestrator.startFocus("basic", "chat-owner");
  setEvidence([sample("a", focus2.focus!.id), sample("b", focus2.focus!.id)]);
  failNextWrite();
  await assert.rejects(orchestrator.endFocus(), /simulated program write failure/);
  assert.equal(stored().programs[0].focus?.id, focus2.focus!.id);
  assert.equal(stored().programs[0].planVersion, 1);
  ended = await orchestrator.endFocus();
  assert.equal(ended.planVersion, 2);
  assert.equal(ended.curriculumRevisions?.length, 1);
  orchestrator.dispose();
});


test("structural preview is read-only until approval, with idempotent commit and durable lineage", async () => {
  const { orchestrator, stored, writes, failNextWrite } = rig();
  const original = await orchestrator.createProgram("Spanish", base);
  const priorWrites = writes();
  const preview = await orchestrator.previewStructuralChange({
    kind: "revise", objectiveId: "basic", changes: { title: "Core vocabulary" },
  }, "Make this topic clearer for the learner", "manual:revise:1");
  assert.equal(preview.fromVersion, 1);
  assert.deepEqual(preview.changedFields, ["title"]);
  assert.equal(writes(), priorWrites, "preview must never save the plan");
  assert.equal(stored().programs[0].objectives[0].title, "Vocabulary");
  failNextWrite();
  await assert.rejects(orchestrator.approveStructuralChange(preview.operationId),
    /simulated program write failure/);
  assert.equal(stored().programs[0].planVersion, 1);
  const approved = await orchestrator.approveStructuralChange(preview.operationId);
  assert.equal(approved.planVersion, 2);
  assert.equal(approved.objectives[0].title, "Core vocabulary");
  assert.deepEqual(approved.curriculumRevisions?.[0].before?.rubric, original.objectives[0].rubric);
  assert.equal(approved.curriculumRevisions?.[0].targetObjectiveId, "basic");
  const afterWrites = writes();
  assert.equal((await orchestrator.approveStructuralChange(preview.operationId)).planVersion, 2);
  assert.equal(writes(), afterWrites, "retry may not create duplicate revision");
  orchestrator.dispose();
});

test("approval rejects a stale diff and never bypasses paused focus locks", async () => {
  const { orchestrator, stored, writes } = rig();
  await orchestrator.createProgram("Spanish", base);
  const preview = await orchestrator.previewStructuralChange({
    kind: "change-prerequisites", objectiveId: "apply", prerequisiteIds: [],
  }, "This prerequisite is no longer required", "manual:detach:1");
  await orchestrator.startFocus("basic", "chat-owner");
  await orchestrator.pauseFocus();
  const beforeWrites = writes();
  await assert.rejects(orchestrator.approveStructuralChange(preview.operationId), /End the active or paused focus/);
  assert.equal(writes(), beforeWrites);
  await orchestrator.endFocus();
  const updated = await orchestrator.approveStructuralChange(preview.operationId);
  assert.deepEqual(updated.objectives[1].prerequisiteIds, []);
  const retire = await orchestrator.previewStructuralChange({
    kind: "deprecate", objectiveId: "basic",
  }, "This objective was superseded by the current curriculum", "manual:retire:1");
  assert.equal(retire.kind, "deprecate");
  await orchestrator.approveStructuralChange(retire.operationId);
  assert.equal(stored().programs[0].objectives[0].deprecated, true);
  const stale = await orchestrator.previewStructuralChange({
    kind: "revise", objectiveId: "apply", changes: { title: "Dialogue practice" },
  }, "Improve the objective title for clarity", "manual:stale:1");
  await orchestrator.previewStructuralChange({
    kind: "revise", objectiveId: "apply", changes: { estimatedMinutes: 45 },
  }, "Adjust time based on learner feedback", "manual:competing:1");
  await orchestrator.approveStructuralChange("manual:competing:1");
  await assert.rejects(orchestrator.approveStructuralChange(stale.operationId), /version conflict/);
  orchestrator.dispose();
});

test("deferrals survive writes, retries and focus end without provider inference", async () => {
  const { orchestrator, stored, failNextWrite } = rig();
  await orchestrator.createProgram("Spanish", base);
  await orchestrator.startFocus("basic", "chat-owner");
  await assert.rejects(
    orchestrator.deferFocusNote("Review network timeouts", "note-1", "other-chat"),
    /another chat/,
  );
  failNextWrite();
  await assert.rejects(
    orchestrator.deferFocusNote("Review network timeouts", "note-1", "chat-owner"),
    /simulated program write failure/,
  );
  assert.equal(stored().programs[0].deferredNotes, undefined);
  await orchestrator.deferFocusNote("Review network timeouts", "note-1", "chat-owner");
  await orchestrator.deferFocusNote("Review network timeouts", "note-1", "chat-owner");
  assert.equal((await orchestrator.getDeferredNotes()).length, 1);
  assert.equal(stored().programs[0].focus?.status, "active");
  await assert.rejects(
    orchestrator.deferFocusNote("Different note", "note-1", "chat-owner"),
    /different content/,
  );
  await orchestrator.endFocus();
  assert.equal((await orchestrator.getDeferredNotes())[0].text, "Review network timeouts");
  await assert.rejects(
    orchestrator.deferFocusNote("Another note", "note-2", "chat-owner"),
    /Start or resume objective focus/,
  );
  orchestrator.dispose();
});


test("startFocus does not bypass transfer gate or an unresolved misconception", async () => {
  const { orchestrator, setEvidence, setGaps } = rig();
  const program = await orchestrator.createProgram("Spanish", base);
  const now = Date.now();
  const good = (id: string, when: number, taskKind: LearningEvidence["taskKind"]) =>
    ({ id, type: "practice" as const, scope: "learner" as const,
      programId: program.id, objectiveId: "basic", source: "spanish.md",
      concept: "Spanish", outcome: "correct" as const, createdAt: when,
      taskKind, rubricResults: [{ criterion: "Recall independently", criterionId: "c1",
        met: true, evidence: "Independent attempt" }],
      objectiveRevision: program.planVersion, assisted: false });
  const work = good("w", now - 48 * 3_600_000, "guided-practice");
  const recall = good("r", now - 24 * 3_600_000, "recall");
  setEvidence([work, recall]);
  await assert.rejects(orchestrator.startFocus("apply"), /prerequisite/);
  const transfer = good("t", now - 1000, "transfer");
  setEvidence([work, recall, transfer]);
  setGaps([{ id: "gap", concept: "Spanish", reason: "Missed translation",
    evidenceIds: ["failed"], status: "open",
    programId: program.id, objectiveId: "basic" }]);
  // An orphan gap cannot invent a learning failure.
  const started = await orchestrator.startFocus("apply");
  assert.equal(started.focus?.objectiveId, "apply");
  await orchestrator.endFocus();
  setEvidence([...([work, recall, transfer]), {
    ...work, id: "failed", createdAt: now - 600, outcome: "incorrect" as const,
    rubricResults: [{ criterion: "Recall independently", criterionId: "c1",
      met: false, evidence: "Failed" }],
  }]);
  await assert.rejects(orchestrator.startFocus("apply"), /prerequisite/);
  orchestrator.dispose();
});


test("shared commit gate queues actual orchestrator focus transitions until prior outcome work finishes", async () => {
  const gate = new LearningMutationGate();
  const { orchestrator, stored } = rig(draft(), true, gate);
  await orchestrator.createProgram("Spanish", base);
  let entered!: () => void;
  let release!: () => void;
  const writerEntered = new Promise<void>(resolve => { entered = resolve; });
  const writerHeld = new Promise<void>(resolve => { release = resolve; });
  const canonicalCommit = gate.run(async () => {
    entered();
    await writerHeld;
    return "transcript + progress durable";
  });
  await writerEntered;
  const focus = orchestrator.startFocus("basic", "owner");
  await Promise.resolve();
  assert.equal(stored().programs[0].focus, undefined,
    "focus mutation must wait until prior canonical commit completes");
  release();
  assert.equal(await canonicalCommit, "transcript + progress durable");
  assert.equal((await focus).focus?.chatSessionId, "owner");
  orchestrator.dispose();
});
