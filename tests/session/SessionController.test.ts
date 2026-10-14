import assert from "node:assert/strict";
import test from "node:test";
import { SessionController } from "../../src/session/SessionController";
import { SessionStore } from "../../src/session/SessionStore";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";

function pluginHarness(initial: Record<string, unknown> | null = null) {
  let data = initial;
  return {
    plugin: {
      loadData: async () => data,
      saveData: async (next: Record<string, unknown>) => {
        data = next;
      },
    },
    getData: () => data,
  };
}

function createController(
  harness: ReturnType<typeof pluginHarness>,
  options: ConstructorParameters<typeof SessionStore>[0] = {
    now: () => 1,
    uuid: () => "session-1",
  },
) {
  return new SessionController(
    new PluginDataRepository(harness.plugin as never),
    new SessionStore(options),
  );
}

test("initializes a conversation without depending on runtime availability", async () => {
  const harness = pluginHarness();
  const controller = createController(harness);

  await controller.init();

  assert.equal(controller.getSession().id, "session-1");
});

test("provider changes clear only runtime cursor/model and preserve transcript and mode", async () => {
  const harness = pluginHarness();
  let id = 0;
  const controller = createController(harness, { uuid: () => `session-${++id}`, now: () => id });
  await controller.init();
  await controller.configureRuntime("agy");
  const agyId = controller.getSession().id;
  await controller.setModel("agy-model");
  await controller.setConversationId("agy-thread");
  await controller.recordScopeChange({ mode: "FOCUSED_LEARNING" }, "/mode focused", "ready", agyId);
  await controller.setConversationId("agy-thread");
  const transcript = controller.getSession().messages;
  await controller.newSession();
  await controller.configureRuntime("codex", "codex-model");
  await controller.selectSession(agyId);
  assert.equal(controller.getSession().runtimeProvider, "codex");
  assert.equal(controller.getSession().conversationId, undefined);
  assert.equal(controller.getSession().model, "codex-model");
  assert.deepEqual(controller.getSession().messages, transcript);
  assert.equal(controller.getSession().learningScope?.mode, "FOCUSED_LEARNING");
  await controller.setConversationId("codex-thread");
  const restarted = createController(harness);
  await restarted.init();
  await restarted.configureRuntime("codex");
  assert.equal(restarted.getSession().conversationId, "codex-thread");
  assert.equal(restarted.getSession().model, "codex-model");
  await restarted.configureRuntime("agy");
  assert.equal(restarted.getSession().conversationId, undefined);
  assert.equal(restarted.getSession().model, undefined);
  assert.deepEqual(restarted.getSession().messages, transcript);
});

test("failed runtime selection leaves the previous cursor/model authoritative", async () => {
  let saved: Record<string, unknown> | null = null;
  let fail = false;
  const controller = new SessionController(new PluginDataRepository({
    loadData: async () => saved,
    saveData: async (next: Record<string, unknown>) => {
      if (fail) throw new Error("disk failed");
      saved = structuredClone(next);
    },
  } as never), new SessionStore());
  await controller.init();
  await controller.configureRuntime("agy");
  await controller.setModel("old-model");
  await controller.setConversationId("old-thread");
  fail = true;
  await assert.rejects(controller.configureRuntime("codex", "new-model"));
  assert.equal(controller.getSession().runtimeProvider, "agy");
  assert.equal(controller.getSession().model, "old-model");
  assert.equal(controller.getSession().conversationId, "old-thread");
  fail = false;
  await controller.configureRuntime("codex", "new-model");
  assert.equal(controller.getSession().runtimeProvider, "codex");
  assert.equal(controller.getSession().conversationId, undefined);
});

test("conversation mutations persist display messages and conversation id", async () => {
  const harness = pluginHarness();
  const controller = createController(harness);

  await controller.init();
  await controller.recordUserMessage("what the user typed");
  await controller.setConversationId("conversation-1");
  await controller.recordAssistantMessage("answer", "note.md");

  assert.equal(
    controller.getSession().messages[0]?.content,
    "what the user typed",
  );
  assert.equal(
    controller.getSession().conversationId,
    "conversation-1",
  );
  assert.equal(
    controller.getSession().messages[1]?.sourcePath,
    "note.md",
  );
  assert.ok(harness.getData());
});

test("blank assistant messages are not persisted", async () => {
  const harness = pluginHarness();
  const controller = createController(harness);

  await controller.init();
  await controller.recordAssistantMessage("   ");

  assert.deepEqual(controller.getSession().messages, []);
});

test("records assistant message with thought and elapsedMs", async () => {
  const harness = pluginHarness();
  const controller = createController(harness);

  await controller.init();
  await controller.recordAssistantMessage(
    "Response text",
    "note.md",
    undefined,
    "Thinking process content",
    3500,
  );

  const message = controller.getSession().messages[0];
  assert.equal(message?.content, "Response text");
  assert.equal(message?.thought, "Thinking process content");
  assert.equal(message?.elapsedMs, 3500);
});

test("lists sessions and restores a selected session as current", async () => {
  const harness = pluginHarness();
  let id = 0;
  let now = 0;

  const controller = createController(harness, {
    now: () => ++now,
    uuid: () => `session-${++id}`,
  });

  await controller.init();
  const first = controller.getSession();
  const second = await controller.newSession();

  assert.deepEqual(
    controller.listSessions().map((session) => session.id),
    [second.id, first.id],
  );

  const selected = await controller.selectSession(first.id);
  assert.equal(selected?.id, first.id);
  assert.equal(controller.getSession().id, first.id);
  assert.equal(
    (harness.getData() as { "nox-sessions"?: { currentSessionId?: string } })[
      "nox-sessions"
    ]?.currentSessionId,
    first.id,
  );
});


test("leaving a session makes its pending proposals stale", async () => {
  const harness = pluginHarness();
  let id = 0;
  const controller = createController(harness, {
    now: () => 1,
    uuid: () => `session-${++id}`,
  });

  await controller.init();
  const firstId = controller.getSession().id;
  await controller.recordProposal(
    "proposal-1",
    {
      file: "note.md",
      original: "before",
      replacement: "after",
    },
    "note.md",
  );

  assert.deepEqual(controller.getProposal("proposal-1"), {
    proposal: {
      file: "note.md",
      original: "before",
      replacement: "after",
    },
    mutableFile: "note.md",
    state: "pending",
  });

  await controller.newSession();
  await controller.selectSession(firstId);

  assert.equal(
    controller.getProposal("proposal-1")?.state,
    "stale",
  );
});

test("late turn writes are scoped to the original session even after switching", async () => {
  const harness = pluginHarness();
  let id = 0;
  const controller = createController(harness, {
    now: () => 1,
    uuid: () => `session-${++id}`,
  });
  await controller.init();
  const originalId = controller.getSession().id;
  const second = await controller.newSession();

  await controller.recordUserMessage("from A", originalId);
  await controller.recordAssistantMessage("answer A", "note-a.md", originalId);
  await controller.setConversationId("conversation-A", originalId);

  assert.equal(controller.getSession().id, second.id);
  assert.deepEqual(controller.getSession().messages, []);
  assert.equal(controller.getSession().conversationId, undefined);

  await controller.selectSession(originalId);
  assert.deepEqual(controller.getSession().messages.map(message => message.content), [
    "from A", "answer A",
  ]);
  assert.equal(controller.getSession().conversationId, "conversation-A");
});

test("public getters cannot mutate canonical proposal history", async () => {
  const h = pluginHarness();
  const controller = createController(h);
  await controller.init();
  await controller.recordProposal("proposal", {
    file: "note.md", original: "old", replacement: "new",
  }, "note.md");
  const session = controller.getSession();
  session.messages[0]!.proposal!.replacement = "injected";
  session.messages[0]!.proposalState = "applied";
  controller.listSessions()[0]!.messages.length = 0;
  assert.equal(controller.getProposal("proposal")?.proposal.replacement, "new");
  assert.equal(controller.getProposal("proposal")?.state, "pending");
  await controller.updateProposalState("proposal", "applied");
  assert.equal(controller.getProposal("proposal")?.state, "applied");
});

test("retrying a staged structured part after save failure persists exactly once", async () => {
  let saves = 0;
  let durable: Record<string, unknown> | null = null;
  const plugin = {
    loadData: async () => durable,
    saveData: async (next: Record<string, unknown>) => {
      if (++saves === 1) throw new Error("temporary disk error");
      durable = next;
    },
  };
  const controller = new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ now: () => 1, uuid: () => "retry-session" }),
  );
  await controller.init();
  const part = {
    type: "practice-evaluation" as const,
    questionId: "q-1",
    evaluation: {
      kind: "evaluation" as const,
      concept: "ACID",
      outcome: "correct" as const,
      feedback: "Correct",
      misconceptions: [],
    },
  };
  await assert.rejects(controller.recordStructuredPart(part));
  await controller.recordStructuredPart(part);
  const reloaded = new SessionStore();
  await reloaded.load(durable);
  assert.equal(reloaded.getCurrentSession()?.messages.length, 1);
  assert.equal(reloaded.getCurrentSession()?.messages[0]?.parts?.[0]?.type, "practice-evaluation");
});

test("practice outcome is atomic in plugin data and is not staged on write failure", async () => {
  let durable: Record<string, unknown> | null = null;
  let shouldFail = true;
  const plugin = {
    loadData: async () => durable,
    saveData: async (value: Record<string, unknown>) => {
      if (shouldFail) throw new Error("disk failure");
      durable = structuredClone(value);
    },
  };
  const controller = new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ now: () => 10, uuid: () => "s-1" }),
  );
  await controller.init();
  const parts = [
    { type: "practice-evaluation" as const,
      operationId: "practice:s-1:q-1", questionId: "q-1", nextQuestionId: "q-2",
      evaluation: { kind: "evaluation" as const, concept: "SQL",
        outcome: "partial" as const, feedback: "Explain isolation",
        misconceptions: [], nextQuestion: "Next?" },
      sourcePath: "note.md" },
    { type: "practice-question" as const, questionId: "q-2",
      question: { kind: "question" as const, concept: "SQL", question: "Next?" },
      origin: { file: "note.md" } },
  ];
  await assert.rejects(controller.recordPracticeOutcome(parts, "practice:s-1:q-1", "note.md", "s-1"));
  assert.equal(controller.getSession().messages.length, 0);
  shouldFail = false;
  const committed = await controller.recordPracticeOutcome(parts, "practice:s-1:q-1", "note.md", "s-1");
  assert.equal(committed.length, 2);
  assert.equal(controller.getSession().messages.length, 1);
  assert.equal(controller.getSession().messages[0]?.parts?.length, 2);
  const restored = new SessionStore();
  await restored.load(durable);
  assert.equal(restored.getCurrentSession()?.messages[0]?.parts?.length, 2);
  await controller.recordPracticeOutcome(parts, "practice:s-1:q-1", "note.md", "s-1");
  assert.equal(controller.getSession().messages.length, 1);
});

test("overlapping outcomes in different sessions never overwrite one another", async () => {
  let durable: Record<string, unknown> | null = null;
  let blockNextSave = false;
  let beginBlockedSave!: () => void;
  let releaseBlockedSave!: () => void;
  const saveBegan = new Promise<void>((resolve) => { beginBlockedSave = resolve; });
  const permitSave = new Promise<void>((resolve) => { releaseBlockedSave = resolve; });

  const plugin = {
    loadData: async () => durable === null ? null : structuredClone(durable),
    saveData: async (next: Record<string, unknown>) => {
      if (blockNextSave) {
        blockNextSave = false;
        beginBlockedSave();
        await permitSave;
      }
      durable = structuredClone(next);
    },
  };
  let nextId = 0;
  const controller = new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ now: () => 10, uuid: () => `session-${++nextId}` }),
  );
  await controller.init();
  const firstId = controller.getSession().id;
  const secondId = (await controller.newSession()).id;

  const practicePart = {
    type: "practice-evaluation" as const,
    operationId: `practice:${firstId}:q-1`,
    questionId: "q-1",
    evaluation: { kind: "evaluation" as const, concept: "ACID",
      outcome: "correct" as const, feedback: "Good", misconceptions: [] },
  };
  const reviewPart = {
    type: "review-findings" as const,
    reviewId: `review:${secondId}:turn-1`,
    findings: [{ kind: "missing-relation" as const,
      concept: "Isolation", title: "Isolation", detail: "Describe concurrency" }],
  };

  blockNextSave = true;
  const first = controller.recordPracticeOutcome(
    [practicePart], practicePart.operationId, "first.md", firstId,
  );
  await saveBegan;
  const second = controller.recordReviewOutcome(reviewPart, "second.md", secondId);
  releaseBlockedSave();
  await Promise.all([first, second]);

  const restored = new SessionStore();
  await restored.load(durable);
  assert.equal(restored.getSession(firstId)?.messages[0]?.parts?.[0]?.type, "practice-evaluation");
  assert.equal(restored.getSession(secondId)?.messages[0]?.parts?.[0]?.type, "review-findings");
  assert.equal(controller.listSessions().length, 2);
});

test("overlapping outcomes in the same session preserve both committed transcript parts", async () => {
  let durable: Record<string, unknown> | null = null;
  let blockNextSave = false;
  let signalSave!: () => void;
  let releaseSave!: () => void;
  const entered = new Promise<void>((resolve) => { signalSave = resolve; });
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const plugin = {
    loadData: async () => durable === null ? null : structuredClone(durable),
    saveData: async (next: Record<string, unknown>) => {
      if (blockNextSave) {
        blockNextSave = false;
        signalSave();
        await gate;
      }
      durable = structuredClone(next);
    },
  };
  const controller = new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ now: () => 1, uuid: () => "session-1" }),
  );
  await controller.init();
  const sessionId = controller.getSession().id;
  const practicePart = {
    type: "practice-evaluation" as const,
    operationId: "practice:session-1:q-1", questionId: "q-1",
    evaluation: { kind: "evaluation" as const, concept: "Atomicity",
      outcome: "correct" as const, feedback: "Good", misconceptions: [] },
  };
  const reviewPart = {
    type: "review-findings" as const,
    reviewId: "review:session-1:turn-1",
    findings: [{ kind: "weak-explanation" as const,
      concept: "Atomicity", title: "Missing context", detail: "Add explanation" }],
  };

  blockNextSave = true;
  const practice = controller.recordPracticeOutcome(
    [practicePart], practicePart.operationId, "note.md", sessionId,
  );
  await entered;
  const review = controller.recordReviewOutcome(reviewPart, "note.md", sessionId);
  releaseSave();
  await Promise.all([practice, review]);

  const reloaded = new SessionStore();
  await reloaded.load(durable);
  const parts = reloaded.getSession(sessionId)?.messages.flatMap((message) => message.parts ?? []);
  assert.deepEqual(parts?.map((part) => part.type), ["practice-evaluation", "review-findings"]);
  assert.equal(controller.getSession().messages.length, 2);
});

test("an ordinary message arriving during an outcome write survives restart", async () => {
  let durable: Record<string, unknown> | null = null;
  let block = true;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const plugin = {
    loadData: async () => durable === null ? null : structuredClone(durable),
    saveData: async (next: Record<string, unknown>) => {
      if (block) {
        block = false;
        entered();
        await gate;
      }
      durable = structuredClone(next);
    },
  };
  const controller = new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ now: () => 1, uuid: () => "session-1" }),
  );
  await controller.init();
  const evaluation = {
    type: "practice-evaluation" as const,
    operationId: "practice:session-1:q-1", questionId: "q-1",
    evaluation: { kind: "evaluation" as const, concept: "Isolation",
      outcome: "correct" as const, feedback: "Good", misconceptions: [] },
  };
  const first = controller.recordPracticeOutcome(
    [evaluation], evaluation.operationId, "note.md", "session-1",
  );
  await started;
  const second = controller.recordUserMessage("Queued user message", "session-1", "ask");
  release();
  await Promise.all([first, second]);

  const restored = new SessionStore();
  await restored.load(durable);
  const messages = restored.getSession("session-1")?.messages;
  assert.deepEqual(messages?.map((message) => message.role), ["assistant", "user"]);
  assert.equal(messages?.[0]?.parts?.[0]?.type, "practice-evaluation");
  assert.equal(messages?.[1]?.content, "Queued user message");
  assert.deepEqual(controller.getSession().messages, messages);
});


test("failed proposal-state persistence leaves in-memory state unchanged until retry", async () => {
  let durable: Record<string, unknown> | null = null;
  let failNext = false;
  const plugin = {
    loadData: async () => durable ? structuredClone(durable) : null,
    saveData: async (data: Record<string, unknown>) => {
      if (failNext) {
        failNext = false;
        throw new Error("storage unavailable");
      }
      durable = structuredClone(data);
    },
  };
  const controller = new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ now: () => 1, uuid: () => "session-1" }),
  );
  await controller.init();
  await controller.recordEditOutcome("edit:session-1:t-1", {
    file: "note.md", original: "before", replacement: "after",
  }, "Explanation", "note.md", "session-1");

  failNext = true;
  await assert.rejects(controller.updateProposalState("edit:session-1:t-1", "applied"),
    /Unable to persist/);
  assert.equal(controller.getProposal("edit:session-1:t-1")?.state, "pending");
  const restoredBeforeRetry = new SessionStore();
  await restoredBeforeRetry.load(durable);
  // SessionStore intentionally marks pending approvals stale on restart.
  assert.equal(restoredBeforeRetry.getCurrentSession()?.messages.find((m) => m.proposalId)?.proposalState, "stale");
  await controller.updateProposalState("edit:session-1:t-1", "applied");
  assert.equal(controller.getProposal("edit:session-1:t-1")?.state, "applied");
});


test("failed ordinary session writes do not publish unsaved messages, model or cursor", async () => {
  let persisted: Record<string, unknown> | null = null;
  let fail = false;
  const plugin = {
    loadData: async () => persisted,
    saveData: async (next: Record<string, unknown>) => {
      if (fail) throw new Error("disk failure");
      persisted = structuredClone(next);
    },
  };
  const controller = new SessionController(new PluginDataRepository(plugin as never), new SessionStore());
  await controller.init();
  await controller.recordUserMessage("committed");
  await controller.setModel("original-model");
  await controller.setConversationId("original-thread");
  const before = controller.getSession();
  const savedBefore = structuredClone(persisted);

  fail = true;
  await assert.rejects(controller.recordUserMessage("not committed"));
  await assert.rejects(controller.recordAssistantMessage("not committed"));
  await assert.rejects(controller.setConversationId("wrong-thread"));
  await assert.rejects(controller.setModel("wrong-model"));
  await assert.rejects(controller.recordProposal("unsaved", {
    file: "note.md", original: "old", replacement: "new",
  }, "note.md"));
  assert.deepEqual(controller.getSession(), before);
  assert.deepEqual(persisted, savedBefore);
  assert.equal(controller.getProposal("unsaved"), null);

  fail = false;
  await controller.recordAssistantMessage("saved after retry");
  assert.equal(controller.getSession().messages.length, 2);
  assert.equal(controller.getSession().model, "original-model");
});

test("failed session creation and selection preserve current session and pending proposals", async () => {
  let persisted: Record<string, unknown> | null = null;
  let fail = false;
  let id = 0;
  const plugin = {
    loadData: async () => persisted,
    saveData: async (next: Record<string, unknown>) => {
      if (fail) throw new Error("disk failure");
      persisted = structuredClone(next);
    },
  };
  const controller = new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ uuid: () => `session-${++id}`, now: () => id }),
  );
  await controller.init();
  const first = controller.getSession().id;
  await controller.recordProposal("first-proposal", {
    file: "note.md", original: "old", replacement: "new",
  }, "note.md");

  fail = true;
  await assert.rejects(controller.newSession());
  assert.equal(controller.getSession().id, first);
  assert.equal(controller.getProposal("first-proposal")?.state, "pending");
  assert.equal(controller.listSessions().length, 1);

  fail = false;
  const second = await controller.newSession();
  await controller.recordProposal("second-proposal", {
    file: "other.md", original: "before", replacement: "after",
  }, "other.md");

  fail = true;
  await assert.rejects(controller.selectSession(first));
  assert.equal(controller.getSession().id, second.id);
  assert.equal(controller.getProposal("second-proposal")?.state, "pending");
  assert.equal(controller.listSessions().length, 2);
  fail = false;
  await controller.selectSession(first);
  assert.equal(controller.getProposal("first-proposal")?.state, "stale");
});

test("proposal updates can target their originating conversation explicitly", async () => {
  let id = 0;
  const harness = pluginHarness();
  const controller = createController(harness, {
    uuid: () => `session-${++id}`, now: () => 1,
  });
  await controller.init();
  const first = controller.getSession().id;
  const second = await controller.newSession();
  await controller.recordProposal("late-proposal", {
    file: "note.md", original: "old", replacement: "new",
  }, "note.md", first);
  await controller.updateProposalState("late-proposal", "applied", first);
  assert.equal(controller.getSession().id, second.id);
  assert.equal(controller.getProposal("late-proposal"), null);
  await controller.selectSession(first);
  assert.equal(controller.getProposal("late-proposal")?.state, "applied");
});

test("quiz draft survives restart and is atomically removed after committed evaluation", async () => {
  const harness = pluginHarness();
  const writer = createController(harness);
  await writer.init();
  const questionId = "quiz-q-1";
  await writer.recordStructuredPart({ type: "practice-question", questionId, question: {
    kind: "question", concept: "Spring", question: "Which injection?", input: {
      type: "multiple-choice", options: [
        { id: "a", text: "Field" }, { id: "b", text: "Constructor" },
      ], correctOptionId: "b", explanation: "Constructor injection",
    },
  } });
  await writer.savePracticeDraft(questionId, { type: "multiple-choice", optionId: "b" });
  const restarted = createController(harness);
  await restarted.init();
  assert.deepEqual(restarted.getSession().practiceDrafts?.[questionId],
    { type: "multiple-choice", optionId: "b" });

  const operationId = "practice:session-1:quiz-q-1";
  await restarted.recordPracticeOutcome([{
    type: "practice-evaluation", questionId, operationId,
    evaluation: { kind: "evaluation", concept: "Spring",
      outcome: "correct", feedback: "Correct", misconceptions: [] },
  }], operationId, "note.md", "session-1");
  assert.equal(restarted.getSession().practiceDrafts?.[questionId], undefined);
  await assert.rejects(restarted.savePracticeDraft(questionId,
    { type: "multiple-choice", optionId: "a" }));
  const reloaded = createController(harness);
  await reloaded.init();
  assert.equal(reloaded.getSession().practiceDrafts?.[questionId], undefined);
  assert.equal(reloaded.getSession().messages.flatMap(m => m.parts ?? [])
    .filter(part => part.type === "practice-evaluation").length, 1);
});

test("quiz draft write failure does not mutate the in-memory canonical session", async () => {
  let data: Record<string, unknown> | null = null;
  let rejectWrite = false;
  const repo = new PluginDataRepository({
    loadData: async () => data,
    saveData: async (next: Record<string, unknown>) => {
      if (rejectWrite) throw new Error("disk full");
      data = next;
    },
  } as never);
  const writer = new SessionController(repo, new SessionStore({
    now: () => 1, uuid: () => "session-1",
  }));
  await writer.init();
  await writer.recordStructuredPart({ type: "practice-question", questionId: "q",
    question: { kind: "question", concept: "IoC", question: "Explain." } });
  rejectWrite = true;
  await assert.rejects(writer.savePracticeDraft("q", { type: "essay", text: "My draft" }));
  assert.equal(writer.getSession().practiceDrafts?.q, undefined);
  rejectWrite = false;
  await writer.savePracticeDraft("q", { type: "essay", text: "My draft" });
  assert.equal(writer.getSession().practiceDrafts?.q?.type, "essay");
});
