import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, TFile } from "obsidian";
import type { AgentStreamEvent, EditProposal } from "../../../src/types";
import { AgentRuntime } from "../../../src/agent/AgentRuntime";
import { ContextResolver } from "../../../src/context/ContextResolver";
import { ObsidianContext } from "../../../src/context/ObsidianContext";
import { LearningController } from "../../../src/learning/LearningController";
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

function makeRig() {
  let pluginData: Record<string, unknown> | null = null;
  let failProgressWrites = 0;
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
    const learning = new LearningController(
      sessions, runtime, context, { load: async () => ({
        path: "AGENTS.md", rawInstructions: "",
      }) } as never, new MutationService(app as never), learningState,
    );
    return { sessions, learning, learningState, context };
  };
  return {
    createLearning,
    queue: (events: AgentStreamEvent[]) => pending.push(events),
    progressWriteFails: (count: number) => { failProgressWrites = count; },
    focusNox: () => { isNoteFocused = false; },
    setSelection: (text: string) => { selection = text; },
    getEditedNote: () => editorBuffer,
    undoMockEditor: () => { if (undoBuffer !== null) editorBuffer = undoBuffer; },
    currentAgentCalls: () => runtimeCalls,
    app,
  };
}

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
