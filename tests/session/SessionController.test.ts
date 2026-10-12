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
