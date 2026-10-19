import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, TFile } from "obsidian";
import type { AgentStreamEvent, EditProposal } from "../../../src/types";
import { AgentRuntime } from "../../../src/agent/AgentRuntime";
import { ContextResolver } from "../../../src/context/ContextResolver";
import { ObsidianContext } from "../../../src/context/ObsidianContext";
import { LearningController } from "../../../src/application/LearningController";
import { MutationService } from "../../../src/mutation/MutationService";
import { PluginDataRepository } from "../../../src/persistence/PluginDataRepository";
import { VaultLearningStore } from "../../../src/persistence/VaultLearningStore";
import { SessionController } from "../../../src/session/SessionController";
import { SessionStore } from "../../../src/session/SessionStore";
import { collectEvents } from "../../support/collect-events";

const practice = (payload: object): AgentStreamEvent[] => [
  { type: "text", content: "```learning-practice\n" + JSON.stringify(payload) + "\n```" },
  { type: "completed" },
];
const review = (payload: object): AgentStreamEvent[] => [
  { type: "text", content: "```learning-review\n" + JSON.stringify(payload) + "\n```" },
  { type: "completed" },
];

function makeRig(withProgram = false) {
  let pluginData: Record<string, unknown> | null = null;
  let failProgressWrites = 0;
  let failProposalWrites = 0;
  let failAppliedStatusWrites = 0;
  let editorMutationCount = 0;
  const files = new Map<string, { file: TFile; content: string }>();
  const folders = new Set<string>();
  const addNote = (path: string, content: string) => {
    files.set(path, { file: new TFile(path), content });
  };
  addNote("notes/acid.md", "ACID means atomicity, consistency, isolation, durability.");
  addNote("notes/support.md", "Reference note, read only.");

  let editorBuffer = files.get("notes/acid.md")!.content;
  let selection = "atomicity";
  let isNoteFocused = true;
  let undoBuffer: string | null = null;
  const editor = {
    getSelection: () => selection,
    getValue: () => editorBuffer,
    offsetToPos: (offset: number) => offset,
    replaceRange: (replacement: string, start: number, end: number) => {
      editorMutationCount++;
      undoBuffer = editorBuffer;
      editorBuffer = editorBuffer.slice(0, start) + replacement + editorBuffer.slice(end);
    },
  };
  const noteView = new MarkdownView(files.get("notes/acid.md")!.file, editor);
  const workspace = {
    on: () => () => {},
    getActiveViewOfType: (cls: unknown) =>
      isNoteFocused && cls === MarkdownView ? noteView : null,
    getLeavesOfType: (kind: string) =>
      kind === "markdown" ? [{ view: noteView }] : [],
    getActiveFile: () => isNoteFocused ? noteView.file : null,
  };
  const vault = {
    getFileByPath: (path: string) => files.get(path)?.file ?? null,
    getAbstractFileByPath: (path: string) => folders.has(path) ? { path } : null,
    createFolder: async (path: string) => { folders.add(path); },
    cachedRead: async (file: TFile) => files.get(file.path)!.content,
    read: async (file: TFile) => files.get(file.path)!.content,
    process: async (file: TFile, update: (current: string) => string) => {
      if (file.path.endsWith("progress.json") && failProgressWrites-- > 0) {
        throw new Error("simulated atomic vault write failure");
      }
      const entry = files.get(file.path);
      if (!entry) throw new Error("Missing vault file for atomic update");
      // Match Vault.process: callback failure never replaces bytes.
      entry.content = update(entry.content);
    },
    modify: async (file: TFile, content: string) => {
      if (file.path.endsWith("progress.json") && failProgressWrites-- > 0) {
        throw new Error("simulated vault write failure");
      }
      files.get(file.path)!.content = content;
    },
    create: async (path: string, content: string) => {
      if (path.endsWith("progress.json") && failProgressWrites-- > 0) {
        throw new Error("simulated vault create failure");
      }
      addNote(path, content);
      return files.get(path)!.file;
    },
  };
  const app = { workspace, vault };
  const plugin = {
    registerEvent: () => {},
    loadData: async () => pluginData ? structuredClone(pluginData) : null,
    saveData: async (data: Record<string, unknown>) => {
      const sessions = data["nox-sessions"] as {
        sessions?: Record<string, { messages?: Array<{ proposalId?: string }> }>
      } | undefined;
      const hasProposal = Object.values(sessions?.sessions ?? {})
        .some((session) => session.messages?.some((message) => message.proposalId));
      if (hasProposal && failProposalWrites > 0) {
        failProposalWrites--;
        throw new Error("simulated proposal storage failure");
      }
      const hasApplied = Object.values(sessions?.sessions ?? {}).some((session) =>
        session.messages?.some((message) =>
          (message as { proposalState?: string }).proposalState === "applied"));
      if (hasApplied && failAppliedStatusWrites > 0) {
        failAppliedStatusWrites--;
        throw new Error("simulated applied-status persistence failure");
      }
      pluginData = structuredClone(data);
    },
  };

  const pending: AgentStreamEvent[][] = [];
  let runtimeCalls = 0;
  const agent = {
    check: async () => ({ status: "ready" as const }),
    listModels: async () => [],
    send: async function* () {
      runtimeCalls++;
      const events = pending.shift();
      if (!events) throw new Error("unexpected agent invocation");
      yield* events;
    },
  };
  const createLearning = async () => {
    const sessions = new SessionController(
      new PluginDataRepository(plugin as never), new SessionStore(),
    );
    await sessions.init();
    const runtime = new AgentRuntime(agent);
    await runtime.init();
    const context = new ContextResolver(new ObsidianContext(app as never, plugin as never));
    const learningState = new VaultLearningStore(app as never);
    const programStore = withProgram ? { load: async () => ({
      version: 1 as const, activeProgramId: "acid-program",
      programs: [{
        version: 1 as const, id: "acid-program", goal: "Understand transactions",
        constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
          sourcePaths: [], sourceBound: false, excludedTopics: [] },
        objectives: [{ id: "atomicity", title: "Atomicity", outcome: "Explain atomicity",
          prerequisiteIds: [], estimatedMinutes: 45, rubric: ["Explain rollback"],
          sourceRefs: [], priority: "core" as const }],
        createdAt: Date.now(), planVersion: 1,
        session: { startedAt: Date.now(), timeBudgetMinutes: 45 },
      }],
    }) } : undefined;
    const learning = new LearningController(
      sessions, runtime, context, { load: async () => ({
        path: "AGENTS.md", rawInstructions: "",
      }) } as never, new MutationService(app as never), learningState,
      { programStore: programStore as never },
    );
    return { sessions, learning, learningState, context };
  };
  return {
    createLearning,
    queue: (events: AgentStreamEvent[]) => pending.push(events),
    progressWriteFails: (count: number) => { failProgressWrites = count; },
    proposalWriteFails: (count: number) => { failProposalWrites = count; },
    appliedStatusWriteFails: (count: number) => { failAppliedStatusWrites = count; },
    editorMutationCount: () => editorMutationCount,
    focusNox: () => { isNoteFocused = false; },
    setSelection: (text: string) => { selection = text; },
    getEditedNote: () => editorBuffer,
    undoMockEditor: () => { if (undoBuffer !== null) editorBuffer = undoBuffer; },
    currentAgentCalls: () => runtimeCalls,
    app,
  };
}


for (const terminal of ["failed", "cancelled"] as const) {
  test(`Practice question is not committed when the agent ends ${terminal}`, async () => {
    const rig = makeRig();
    const { learning, sessions } = await rig.createLearning();
    const question = { kind: "question", concept: "ACID", question: "Explain atomicity." };
    rig.queue([
      { type: "text", content: "```learning-practice\n" + JSON.stringify(question) + "\n```" },
      terminal === "failed"
        ? { type: "failed", failure: { code: "process-failed", message: "stream interrupted" } }
        : { type: "cancelled" },
    ]);
    const incomplete = await collectEvents(learning.run({
      prompt: "Quiz me", action: "practice", explicitContext: [],
    }));
    assert.ok(incomplete.some((event) => event.type === terminal));
    assert.equal(incomplete.some((event) => event.type === "practice-question"), false);
    assert.equal(learning.hasActivePracticeQuestion(), false);
    assert.equal(sessions.getSession().messages.flatMap((message) => message.parts ?? [])
      .filter((part) => part.type === "practice-question").length, 0);

    learning.dispose();
    const restored = await rig.createLearning();
    assert.equal(restored.learning.hasActivePracticeQuestion(), false);
    rig.queue(practice(question));
    const success = await collectEvents(restored.learning.run({
      prompt: "Quiz me", action: "practice", explicitContext: [], retry: true,
    }));
    assert.ok(success.some((event) => event.type === "practice-question"));
    assert.equal(restored.learning.hasActivePracticeQuestion(), true);
    assert.equal(restored.sessions.getSession().messages.flatMap((message) => message.parts ?? [])
      .filter((part) => part.type === "practice-question").length, 1);
  });
}

test("a completed Practice turn cannot commit two competing questions", async () => {
  const rig = makeRig();
  const { learning, sessions } = await rig.createLearning();
  const first = { kind: "question", concept: "ACID", question: "What is atomicity?" };
  const second = { kind: "question", concept: "ACID", question: "What is isolation?" };
  rig.queue([
    { type: "text", content: "```learning-practice\n" + JSON.stringify(first) + "\n```" },
    { type: "text", content: "```learning-practice\n" + JSON.stringify(second) + "\n```" },
    { type: "completed" },
  ]);
  const outcome = await collectEvents(learning.run({
    prompt: "Practice", action: "practice", explicitContext: [],
  }));
  assert.ok(outcome.some((event) => event.type === "failed"));
  assert.equal(learning.hasActivePracticeQuestion(), false);
  assert.equal(sessions.getSession().messages.flatMap((message) => message.parts ?? [])
    .filter((part) => part.type === "practice-question").length, 0);
});

test("Practice never commits a partially streamed evaluation after runtime failure", async () => {
  const rig = makeRig();
  const { learning, sessions, learningState } = await rig.createLearning();
  rig.queue(practice({ kind: "question", concept: "ACID", question: "What is atomicity?" }));
  await collectEvents(learning.run({ prompt: "Practice", action: "practice", explicitContext: [] }));
  const outcome = { kind: "evaluation", concept: "ACID", outcome: "correct",
    feedback: "Correct", misconceptions: [] };
  rig.queue([
    { type: "text", content: "```learning-practice\n" + JSON.stringify(outcome) + "\n```" },
    { type: "failed", failure: { code: "process-failed", message: "agent crashed" } },
  ]);
  const failed = await collectEvents(learning.run({
    prompt: "All-or-nothing", action: "practice", explicitContext: [],
  }));
  assert.ok(failed.some((event) => event.type === "failed"));
  assert.equal(failed.some((event) => event.type === "practice-evaluation"), false);
  assert.equal(learning.hasActivePracticeQuestion(), true);
  assert.equal((await learningState.load()).evidence.length, 0);
  assert.equal(sessions.getSession().messages.flatMap((message) => message.parts ?? [])
    .filter((part) => part.type === "practice-evaluation").length, 0);

  rig.queue(practice(outcome));
  const success = await collectEvents(learning.run({
    prompt: "All-or-nothing", action: "practice", explicitContext: [], retry: true,
  }));
  assert.ok(success.some((event) => event.type === "practice-evaluation"));
  assert.equal((await learningState.load()).evidence.length, 1);
});

test("Practice persists one outcome and replays missing evidence after simulated restart", async () => {
  const rig = makeRig();
  const first = await rig.createLearning();
  rig.queue(practice({ kind: "question", concept: "ACID", question: "Define isolation." }));
  await collectEvents(first.learning.run({
    prompt: "Practice", action: "practice", explicitContext: [],
  }));
  rig.progressWriteFails(1);
  rig.queue(practice({ kind: "evaluation", concept: "ACID", outcome: "correct",
    feedback: "OK", misconceptions: [] }));
  const failed = await collectEvents(first.learning.run({
    prompt: "Transaction isolation", action: "practice", explicitContext: [],
  }));
  assert.ok(failed.some((event) => event.type === "failed"));
  assert.equal((await first.learningState.load()).evidence.length, 0);
  const before = first.sessions.getSession();
  assert.equal(before.messages.flatMap((message) => message.parts ?? [])
    .filter((part) => part.type === "practice-evaluation").length, 1);

  first.learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.sessions.getSession().id, before.id);
  rig.queue([{ type: "text", content: "The notes are ready." }, { type: "completed" }]);
  await collectEvents(restored.learning.run({
    prompt: "Explain the notes", action: "explain", explicitContext: [],
  }));
  const evidence = (await restored.learningState.load()).evidence;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.outcome, "correct");
  assert.equal(rig.currentAgentCalls(), 3);
});

test("Review is durable only on completion and reconciles once after vault failure", async () => {
  const rig = makeRig();
  const first = await rig.createLearning();
  const payload = { kind: "review", findings: [{
    kind: "missing-relation", concept: "ACID",
    title: "Transaction isolation", detail: "Explain concurrent visibility.",
  }] };
  rig.queue([...review(payload).slice(0, 1), {
    type: "failed", failure: { code: "process-failed", message: "crashed" },
  }]);
  await collectEvents(first.learning.run({
    prompt: "Review", action: "review", turnId: "review-1", explicitContext: [],
  }));
  assert.equal(first.sessions.getSession().messages.flatMap((msg) => msg.parts ?? [])
    .filter((part) => part.type === "review-findings").length, 0);

  rig.progressWriteFails(1);
  rig.queue(review(payload));
  const failed = await collectEvents(first.learning.run({
    prompt: "Review", action: "review", turnId: "review-1", retry: true, explicitContext: [],
  }));
  assert.ok(failed.some((event) => event.type === "failed"));
  assert.equal((await first.learningState.load()).evidence.length, 0);

  first.learning.dispose();
  const restored = await rig.createLearning();
  rig.queue([{ type: "text", content: "ready" }, { type: "completed" }]);
  await collectEvents(restored.learning.run({
    prompt: "Continue", action: "ask", explicitContext: [],
  }));
  const evidence = (await restored.learningState.load()).evidence;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.id, "review:" + restored.sessions.getSession().id + ":review-1:0");
});

test("selection survives sidebar focus; edit stays on authorized editor and mock undo recovers", async () => {
  const rig = makeRig();
  const { context } = await rig.createLearning();
  rig.setSelection("atomicity");
  rig.focusNox();
  const resolved = await context.resolve([{ kind: "vault-note", path: "notes/support.md" }]);
  assert.equal(resolved.selection?.content, "atomicity");
  assert.equal(resolved.activeNote?.path, "notes/acid.md");
  const visible = context.toAgentContext(resolved);
  assert.equal(visible[0]?.type, "selection");
  assert.equal(visible[0]?.file, "notes/acid.md");

  const edits = new MutationService(rig.app as never);
  const proposal: EditProposal = {
    file: "notes/acid.md", original: "atomicity", replacement: "atomic execution",
  };
  const denied = await edits.apply({ ...proposal, file: "notes/support.md" }, "notes/acid.md");
  assert.equal(denied.ok, false);
  const original = rig.getEditedNote();
  const applied = await edits.apply(proposal, "notes/acid.md");
  assert.equal(applied.ok, true);
  assert.ok(rig.getEditedNote().includes("atomic execution"));
  rig.undoMockEditor();
  assert.equal(rig.getEditedNote(), original);
});

test("cancelled agent turn cannot commit already-parsed Practice evaluation", async () => {
  const rig = makeRig();
  const { learning, sessions, learningState } = await rig.createLearning();
  rig.queue(practice({ kind: "question", concept: "ACID", question: "Define atomicity." }));
  await collectEvents(learning.run({
    prompt: "Practice", action: "practice", explicitContext: [],
  }));
  const evaluation = { kind: "evaluation", concept: "ACID",
    outcome: "correct", feedback: "Correct", misconceptions: [] };
  rig.queue([
    { type: "text", content: "```learning-practice\n" + JSON.stringify(evaluation) + "\n```" },
    { type: "cancelled" },
  ]);
  const outcome = await collectEvents(learning.run({
    prompt: "One atomic operation", action: "practice", explicitContext: [],
  }));
  assert.ok(outcome.some((event) => event.type === "cancelled"));
  assert.equal(outcome.some((event) => event.type === "practice-evaluation"), false);
  assert.equal(learning.hasActivePracticeQuestion(), true);
  assert.equal((await learningState.load()).evidence.length, 0);
  assert.equal(sessions.getSession().messages.flatMap((message) => message.parts ?? [])
    .filter((part) => part.type === "practice-evaluation").length, 0);
});

test("next Practice question and its source survive plugin recreation", async () => {
  const rig = makeRig();
  const first = await rig.createLearning();
  rig.queue(practice({ kind: "question", concept: "ACID", question: "What is atomicity?" }));
  await collectEvents(first.learning.run({
    prompt: "Practice", action: "practice", explicitContext: [],
  }));
  rig.queue(practice({ kind: "evaluation", concept: "ACID", outcome: "correct",
    feedback: "Good", misconceptions: [], nextQuestion: "What is durability?" }));
  await collectEvents(first.learning.run({
    prompt: "All-or-nothing", action: "practice", explicitContext: [],
  }));
  const session = first.sessions.getSession();
  const outcomes = session.messages.flatMap((message) => message.parts ?? []);
  assert.equal(outcomes.filter((part) => part.type === "practice-evaluation").length, 1);
  assert.equal(outcomes.filter((part) => part.type === "practice-question").length, 2);
  first.learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.learning.hasActivePracticeQuestion(), true);
  assert.equal(restored.learning.getActivePracticeOrigin()?.file, "notes/acid.md");
  assert.equal(restored.sessions.getSession().messages.flatMap((message) => message.parts ?? [])
    .filter((part) => part.type === "practice-question").length, 2);
});


const editFence = String.fromCharCode(96).repeat(3);
const editPayload: EditProposal = {
  file: "notes/acid.md",
  original: "atomicity",
  replacement: "atomic execution",
  reason: "Use an operational definition.",
};
const streamedEdit = (proposal: EditProposal = editPayload): AgentStreamEvent => ({
  type: "text",
  content: "Before the edit.\n" + editFence + "edit-proposal\n" + JSON.stringify(proposal) +
    "\n" + editFence + "\nAfter the edit.",
});
const editRequest = { prompt: "Fix this definition", action: "edit" as const,
  turnId: "edit-turn-1", explicitContext: [] };

for (const terminal of ["failed", "cancelled"] as const) {
  test("Edit Proposal is never actionable if the agent ends " + terminal, async () => {
    const rig = makeRig();
    const { sessions, learning } = await rig.createLearning();
    rig.queue([streamedEdit(), terminal === "failed"
      ? { type: "failed", failure: { code: "process-failed", message: "crashed" } }
      : { type: "cancelled" }]);
    const events = await collectEvents(learning.run(editRequest));
    assert.ok(events.some((event) => event.type === terminal));
    assert.equal(events.some((event) => event.type === "mutation-proposed"), false);
    assert.equal(sessions.getSession().messages.filter((m) => m.proposal).length, 0);
    assert.equal(rig.getEditedNote().includes("atomic execution"), false);
    learning.dispose();
    const restored = await rig.createLearning();
    assert.equal(restored.sessions.getSession().messages.filter((m) => m.proposal).length, 0);
  });
}

for (const malformed of [
  ["bad-json", editFence + "edit-proposal\n{invalid}\n" + editFence],
  ["incomplete", editFence + "edit-proposal\n" + JSON.stringify(editPayload)],
  ["valid-then-invalid", editFence + "edit-proposal\n" +
    JSON.stringify(editPayload) + "\n" + editFence +
    editFence + "edit-proposal\n{bad json}\n" + editFence],
  ["duplicate", editFence + "edit-proposal\n" + JSON.stringify(editPayload) + "\n" + editFence +
    editFence + "edit-proposal\n" + JSON.stringify(editPayload) + "\n" + editFence],
  ["unauthorized", editFence + "edit-proposal\n" +
    JSON.stringify({ ...editPayload, file: "notes/support.md" }) + "\n" + editFence],
] as const) {
  test("Edit Proposal " + malformed[0] + " does not create partial pending state", async () => {
    const rig = makeRig();
    const { sessions, learning } = await rig.createLearning();
    rig.queue([{ type: "text", content: malformed[1] }, { type: "completed" }]);
    const events = await collectEvents(learning.run(editRequest));
    assert.ok(events.some((event) => event.type === "failed"));
    assert.equal(events.some((event) => event.type === "mutation-proposed"), false);
    assert.equal(sessions.getSession().messages.filter((m) => m.proposal).length, 0);
  });
}

test("Edit Proposal commits once on completion and replays after restart without model invocation", async () => {
  const rig = makeRig();
  const first = await rig.createLearning();
  rig.queue([streamedEdit(), { type: "completed" }]);
  const events = await collectEvents(first.learning.run(editRequest));
  const proposal = events.find((event) => event.type === "mutation-proposed");
  assert.ok(proposal && proposal.type === "mutation-proposed");
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(first.sessions.getSession().messages.filter((m) => m.proposal).length, 1);
  assert.equal(first.sessions.getSession().messages.filter((m) => m.role === "assistant" &&
    m.content.includes("Before the edit.") && m.content.includes("After the edit.")).length, 1);
  const id = proposal.edit.id;
  const replay = await collectEvents(first.learning.run({ ...editRequest, retry: true }));
  assert.equal(replay.filter((event) => event.type === "mutation-proposed").length, 1);
  assert.equal(rig.currentAgentCalls(), 1);
  assert.equal(first.sessions.getSession().messages.filter((m) => m.proposal).length, 1);
  const applied = await first.learning.applyProposal(id);
  assert.equal(applied.ok, true);
  assert.ok(rig.getEditedNote().includes("atomic execution"));
  first.learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.sessions.getProposal(id)?.state, "applied");
  const settled = await collectEvents(restored.learning.run({ ...editRequest, retry: true }));
  assert.equal(settled.some((event) => event.type === "mutation-proposed"), false);
  assert.equal(rig.currentAgentCalls(), 1);
  assert.equal(restored.sessions.getSession().messages.filter((m) => m.proposal).length, 1);
});

test("Edit Proposal persistence failure keeps session clean and retry restores one candidate", async () => {
  const rig = makeRig();
  const { learning, sessions } = await rig.createLearning();
  rig.proposalWriteFails(1);
  rig.queue([streamedEdit(), { type: "completed" }]);
  const failed = await collectEvents(learning.run(editRequest));
  assert.equal(failed.some((event) => event.type === "mutation-proposed"), false);
  assert.equal(failed.some((event) => event.type === "failed"), true);
  assert.equal(sessions.getSession().messages.filter((m) => m.proposal).length, 0);
  learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.sessions.getSession().messages.filter((m) => m.proposal).length, 0);
  rig.queue([streamedEdit(), { type: "completed" }]);
  const success = await collectEvents(restored.learning.run({ ...editRequest, retry: true }));
  assert.equal(success.filter((event) => event.type === "mutation-proposed").length, 1);
  assert.equal(restored.sessions.getSession().messages.filter((m) => m.proposal).length, 1);
});


test("a pending Edit Proposal becomes stale after restart and retry never resurrects it", async () => {
  const rig = makeRig();
  const first = await rig.createLearning();
  rig.queue([streamedEdit(), { type: "completed" }]);
  const firstEvents = await collectEvents(first.learning.run(editRequest));
  const pending = firstEvents.find((event) => event.type === "mutation-proposed");
  assert.ok(pending && pending.type === "mutation-proposed");
  first.learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.sessions.getProposal(pending.edit.id)?.state, "stale");
  const retried = await collectEvents(restored.learning.run({ ...editRequest, retry: true }));
  assert.equal(retried.some((event) => event.type === "mutation-proposed"), false);
  assert.equal(rig.currentAgentCalls(), 1);
  assert.equal(restored.sessions.getSession().messages.filter((m) => m.proposal).length, 1);
});


test("rejected Edit Proposal never reopens on retry", async () => {
  const rig = makeRig();
  const { learning, sessions } = await rig.createLearning();
  rig.queue([streamedEdit(), { type: "completed" }]);
  const events = await collectEvents(learning.run(editRequest));
  const proposal = events.find((event) => event.type === "mutation-proposed");
  assert.ok(proposal && proposal.type === "mutation-proposed");
  await learning.rejectProposal(proposal.edit.id);
  assert.equal(sessions.getProposal(proposal.edit.id)?.state, "rejected");
  const retried = await collectEvents(learning.run({ ...editRequest, retry: true }));
  assert.equal(retried.some((event) => event.type === "mutation-proposed"), false);
  assert.equal(rig.currentAgentCalls(), 1);
  assert.equal(sessions.getSession().messages.filter((m) => m.proposal).length, 1);
});

test("Edit without a proposal completes as ordinary narrative", async () => {
  const rig = makeRig();
  const { learning, sessions } = await rig.createLearning();
  rig.queue([{ type: "text", content: "No exact replacement is needed." }, { type: "completed" }]);
  const events = await collectEvents(learning.run(editRequest));
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(events.some((event) => event.type === "mutation-proposed"), false);
  assert.equal(sessions.getSession().messages.some((m) =>
    m.content.includes("No exact replacement is needed.")), true);
});

test("non-edit actions reject streamed edit proposals", async () => {
  const rig = makeRig();
  const { learning, sessions } = await rig.createLearning();
  rig.queue([streamedEdit(), { type: "completed" }]);
  const events = await collectEvents(learning.run({ ...editRequest, action: "ask" }));
  assert.equal(events.some((event) => event.type === "failed"), true);
  assert.equal(events.some((event) => event.type === "mutation-proposed"), false);
  assert.equal(sessions.getSession().messages.filter((m) => m.proposal).length, 0);
});


test("successful editor Apply with failed status write never suggests editing again", async () => {
  const rig = makeRig();
  const { learning, sessions } = await rig.createLearning();
  rig.queue([streamedEdit(), { type: "completed" }]);
  const events = await collectEvents(learning.run(editRequest));
  const event = events.find((item) => item.type === "mutation-proposed");
  assert.ok(event && event.type === "mutation-proposed");

  rig.appliedStatusWriteFails(1);
  const first = await learning.applyProposal(event.edit.id);
  assert.deepEqual(first, {
    ok: true,
    statusSync: "failed",
    message: "Edit was applied to the note, but its status was not saved. Retry status sync; do not apply the edit again.",
  });
  assert.equal(rig.editorMutationCount(), 1);
  assert.ok(rig.getEditedNote().includes("atomic execution"));
  assert.equal(sessions.getProposal(event.edit.id)?.state, "pending");

  const accidentallyRepeated = await learning.applyProposal(event.edit.id);
  assert.equal(accidentallyRepeated.ok, false);
  assert.equal(rig.editorMutationCount(), 1);
  await assert.rejects(learning.newSession(), /Retry saving applied edit status/);

  const saved = await learning.retryAppliedStatus(event.edit.id);
  assert.deepEqual(saved, { ok: true });
  assert.equal(sessions.getProposal(event.edit.id)?.state, "applied");
  assert.equal(rig.editorMutationCount(), 1);

  learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.sessions.getProposal(event.edit.id)?.state, "applied");
  assert.equal(rig.editorMutationCount(), 1);
});

test("retrying failed status sync does not run editor mutation a second time", async () => {
  const rig = makeRig();
  const { learning, sessions } = await rig.createLearning();
  rig.queue([streamedEdit(), { type: "completed" }]);
  const events = await collectEvents(learning.run(editRequest));
  const event = events.find((item) => item.type === "mutation-proposed");
  assert.ok(event && event.type === "mutation-proposed");

  rig.appliedStatusWriteFails(2);
  await learning.applyProposal(event.edit.id);
  const retryFailed = await learning.retryAppliedStatus(event.edit.id);
  assert.equal(retryFailed.ok, true);
  if (retryFailed.ok) assert.equal(retryFailed.statusSync, "failed");
  assert.equal(rig.editorMutationCount(), 1);
  assert.equal(sessions.getProposal(event.edit.id)?.state, "pending");

  const retried = await learning.retryAppliedStatus(event.edit.id);
  assert.equal(retried.ok, true);
  assert.equal(rig.editorMutationCount(), 1);
  assert.equal(sessions.getProposal(event.edit.id)?.state, "applied");
});

test("restart after unsaved Apply status never silently reactivates proposal", async () => {
  const rig = makeRig();
  const { learning } = await rig.createLearning();
  rig.queue([streamedEdit(), { type: "completed" }]);
  const events = await collectEvents(learning.run(editRequest));
  const event = events.find((item) => item.type === "mutation-proposed");
  assert.ok(event && event.type === "mutation-proposed");

  rig.appliedStatusWriteFails(1);
  await learning.applyProposal(event.edit.id);
  learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.sessions.getProposal(event.edit.id)?.state, "stale");
  const result = await restored.learning.applyProposal(event.edit.id);
  assert.equal(result.ok, false);
  assert.equal(rig.editorMutationCount(), 1);
});


test("completed Practice and Review turns require their structured result", async () => {
  for (const action of ["practice", "review"] as const) {
    const rig = makeRig();
    const { learning, sessions, learningState } = await rig.createLearning();
    rig.queue([{ type: "text", content: "Here is an unstructured answer." }, { type: "completed" }]);
    const events = await collectEvents(learning.run({
      prompt: "Start", action, explicitContext: [],
    }));
    assert.ok(events.some((event) => event.type === "failed" &&
      event.failure.code === "protocol-invalid"), action);
    assert.equal(events.some((event) => event.type === "completed"), false);
    assert.equal(sessions.getSession().messages.flatMap((message) => message.parts ?? []).length, 0);
    assert.equal((await learningState.load()).evidence.length, 0);
    assert.equal(learning.hasActivePracticeQuestion(), false);
  }
});

test("structured agent output must match the selected action", async () => {
  const question = { kind: "question", concept: "ACID", question: "What is atomicity?" };
  const reviewResult = { kind: "review", findings: [] };
  const cases = [
    { action: "ask" as const, response: practice(question) },
    { action: "explain" as const, response: review(reviewResult) },
    { action: "edit" as const, response: practice(question) },
    { action: "practice" as const, response: review(reviewResult) },
    { action: "review" as const, response: practice(question) },
  ];
  for (const { action, response } of cases) {
    const rig = makeRig();
    const { learning, sessions, learningState } = await rig.createLearning();
    rig.queue(response);
    const events = await collectEvents(learning.run({
      prompt: "Test invalid output", action, explicitContext: [],
    }));
    assert.ok(events.some((event) => event.type === "failed" &&
      event.failure.code === "protocol-invalid"), action);
    assert.equal(events.some((event) => event.type === "completed"), false);
    assert.equal(events.some((event) => event.type === "practice-question" ||
      event.type === "review-findings"), false);
    assert.equal(sessions.getSession().messages.flatMap((message) => message.parts ?? []).length, 0);
    assert.equal((await learningState.load()).evidence.length, 0);
  }
});

test("duplicate Review payloads fail without committing partial findings", async () => {
  const rig = makeRig();
  const { learning, sessions, learningState } = await rig.createLearning();
  const finding = { kind: "factual-error", concept: "ACID", title: "Wrong", detail: "Incorrect explanation." };
  rig.queue([
    { type: "text", content: "```learning-review\n" + JSON.stringify({ kind: "review", findings: [finding] }) + "\n```" },
    { type: "text", content: "```learning-review\n" + JSON.stringify({ kind: "review", findings: [] }) + "\n```" },
    { type: "completed" },
  ]);
  const events = await collectEvents(learning.run({ prompt: "Review", action: "review", explicitContext: [] }));
  assert.ok(events.some((event) => event.type === "failed" && event.failure.code === "protocol-invalid"));
  assert.equal(sessions.getSession().messages.flatMap((message) => message.parts ?? []).length, 0);
  assert.equal((await learningState.load()).evidence.length, 0);
});

test("an empty but well-formed Review payload is successful", async () => {
  const rig = makeRig();
  const { learning, sessions } = await rig.createLearning();
  rig.queue(review({ kind: "review", findings: [] }));
  const events = await collectEvents(learning.run({ prompt: "Review", action: "review", explicitContext: [] }));
  assert.ok(events.some((event) => event.type === "completed"));
  assert.ok(events.some((event) => event.type === "review-findings" && event.findings.length === 0));
  assert.equal(sessions.getSession().messages.flatMap((message) => message.parts ?? [])
    .filter((part) => part.type === "review-findings").length, 1);
});

test("domain-neutral program practice commits objective-linked evidence and ignores model nextQuestion", async () => {
  const rig = makeRig(true);
  const { learning, learningState, sessions } = await rig.createLearning();
  rig.queue(practice({ kind: "question", concept: "Backend terms", question: "Explain transaction atomicity.",
    hint: "Think rollback." }));
  const asked = await collectEvents(learning.run({
    prompt: "Quiz me on the next eligible objective", action: "practice", explicitContext: [],
  }));
  const generated = asked.find(event => event.type === "practice-question");
  assert.ok(generated && generated.type === "practice-question");
  assert.equal(generated.question.programId, "acid-program");
  assert.equal(generated.question.objectiveId, "atomicity");
  assert.equal(generated.question.concept, "Atomicity");

  rig.queue(practice({ kind: "evaluation", concept: "Atomicity", outcome: "correct",
    feedback: "All operations roll back together.", misconceptions: [],
    nextQuestion: "The model tries to skip the scheduler",
    rubricResults: [{ criterion: "Explain rollback", met: true,
      evidence: "Described undo on failure" }] }));
  const evaluated = await collectEvents(learning.run({
    prompt: "Either all changes commit or none do", action: "practice", explicitContext: [],
  }));
  assert.ok(evaluated.some(event => event.type === "practice-evaluation"));
  assert.equal(evaluated.some(event => event.type === "practice-question"), false);
  const state = await learningState.load();
  assert.equal(state.evidence.length, 1);
  assert.equal(state.evidence[0].programId, "acid-program");
  assert.equal(state.evidence[0].objectiveId, "atomicity");
  assert.equal(state.evidence[0].rubricResults?.[0].met, true);
  const parts = sessions.getSession().messages.flatMap(item => item.parts ?? []);
  const savedEval = parts.find(part => part.type === "practice-evaluation");
  assert.ok(savedEval && savedEval.type === "practice-evaluation");
  assert.equal(savedEval.evaluation.nextQuestion, undefined);
});

test("hint usage survives restart and cannot count as independent mastery", async () => {
  const rig = makeRig(true);
  const first = await rig.createLearning();
  rig.queue(practice({ kind: "question", concept: "ACID", question: "Explain atomicity.",
    hint: "Rollback means all-or-nothing." }));
  await collectEvents(first.learning.run({
    prompt: "Practice", action: "practice", explicitContext: [],
  }));
  const hint = await collectEvents(first.learning.run({
    prompt: "/hint", action: "practice", explicitContext: [],
  }));
  assert.ok(hint.some(event => event.type === "response-delta" &&
    event.text.includes("Rollback")));
  first.learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.learning.hasActivePracticeQuestion(), true);
  rig.queue(practice({ kind: "evaluation", concept: "Atomicity", outcome: "correct",
    feedback: "Good", misconceptions: [],
    rubricResults: [{ criterion: "Explain rollback", met: true, evidence: "All or nothing" }] }));
  await collectEvents(restored.learning.run({
    prompt: "All or nothing", action: "practice", explicitContext: [],
  }));
  const state = await restored.learningState.load();
  assert.equal(state.evidence.length, 1);
  assert.equal(state.evidence[0].assisted, true);
  const again = await rig.createLearning();
  assert.equal((await again.learningState.load()).evidence[0].assisted, true);
});

test("program evaluator cannot claim correct when its rubric shows a missed criterion", async () => {
  const rig = makeRig(true);
  const { learning, learningState } = await rig.createLearning();
  rig.queue(practice({ kind: "question", concept: "Atomicity", question: "Explain atomicity." }));
  await collectEvents(learning.run({ prompt: "Practice", action: "practice", explicitContext: [] }));
  rig.queue(practice({ kind: "evaluation", concept: "Atomicity", outcome: "correct",
    feedback: "Contradictory", misconceptions: [],
    rubricResults: [{ criterion: "Explain rollback", met: false, evidence: "No rollback mentioned" }] }));
  const failure = await collectEvents(learning.run({
    prompt: "Transactions are fast", action: "practice", explicitContext: [],
  }));
  assert.ok(failure.some(event => event.type === "failed" && event.failure.code === "protocol-invalid"));
  assert.equal((await learningState.load()).evidence.length, 0);
  assert.equal(learning.hasActivePracticeQuestion(), true);
});

test("informational progress message cannot hide an unanswered Practice question on restart", async () => {
  const rig = makeRig(true);
  const initial = await rig.createLearning();
  rig.queue(practice({ kind: "question", concept: "Atomicity", question: "Explain atomicity." }));
  await collectEvents(initial.learning.run({ prompt: "Practice", action: "practice", explicitContext: [] }));
  assert.equal(initial.learning.hasActivePracticeQuestion(), true);
  await initial.sessions.recordUserMessage("/progress", initial.sessions.getSession().id, "ask");
  await initial.sessions.recordAssistantMessage("Still learning", undefined, initial.sessions.getSession().id);
  initial.learning.dispose();
  const restored = await rig.createLearning();
  assert.equal(restored.learning.hasActivePracticeQuestion(), true);
});
