import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentStreamEvent,
  ApplyResult,
  ChatSession,
  EditProposal,
} from "../../src/types";
import { LearningController } from "../../src/learning/LearningController";
import { LearningState } from "../../src/learning/learning-state";
import { collectEvents } from "../support/collect-events";

function baseState(): LearningState {
  return {
    version: 2,
    target: null,
    gaps: [],
    evidence: [],
  };
}

function createHarness(
  sendTurn: (
    prompt: string,
    signal: AbortSignal,
  ) => AsyncIterable<AgentStreamEvent>,
  options: { mutationResult?: ApplyResult } = {},
) {
  let session: ChatSession = {
    id: "session-1",
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
  let nextSessionNumber = 1;
  const sessionRecords = new Map<string, ChatSession>([
    [session.id, session],
  ]);

  const proposalRecords = new Map<
    string,
    {
      proposal: EditProposal;
      mutableFile?: string;
      state: "pending" | "applied" | "rejected" | "stale";
    }
  >();
  const prompts: string[] = [];
  let mutationCalls = 0;
  let mutationTarget: string | undefined;
  let recordedUserMessages = 0;

  const sessions = {
    getSession: () => session,
    listSessions: () => Array.from(sessionRecords.values()),
    selectSession: async (id: string) => {
      const selected = sessionRecords.get(id);
      if (!selected) return null;
      session = selected;
      return selected;
    },
    setModel: async (_model?: string) => {},
    newSession: async () => {
      for (const record of proposalRecords.values()) {
        if (record.state === "pending") record.state = "stale";
      }
      nextSessionNumber += 1;
      session = {
        id: `session-${nextSessionNumber}`,
        messages: [],
        createdAt: nextSessionNumber,
        updatedAt: nextSessionNumber,
      };
      sessionRecords.set(session.id, session);
      return session;
    },
    recordUserMessage: async (_content: string) => { recordedUserMessages += 1; },
    setConversationId: async (_id?: string) => {},
    recordAssistantMessage: async (_content: string) => {},
    recordProposal: async (
      id: string,
      proposal: EditProposal,
      mutableFile?: string,
    ) => {
      proposalRecords.set(id, {
        proposal,
        mutableFile,
        state: "pending",
      });
    },
    getProposal: (id: string) => {
      const record = proposalRecords.get(id);
      return record
        ? {
            proposal: { ...record.proposal },
            mutableFile: record.mutableFile,
            state: record.state,
          }
        : null;
    },
    updateProposalState: async (
      id: string,
      state: "applied" | "rejected" | "stale",
    ) => {
      const record = proposalRecords.get(id);
      if (record?.state === "pending") record.state = state;
    },
  };

  const runtime = {
    check: async () => ({ status: "ready" as const }),
    getModels: () => [],
    send: async function* (
      input: { prompt: string },
      _opts: unknown,
      signal: AbortSignal,
    ) {
      prompts.push(input.prompt);
      yield* sendTurn(input.prompt, signal);
    },
  };

  const contexts = {
    resolve: async () => ({
      activeNote: {
        path: "note.md",
        content: "current note",
      },
      explicit: [],
    }),
    searchNotes: () => [],
    toAgentContext: () => [
      {
        type: "note" as const,
        file: "note.md",
        content: "current note",
      },
    ],
  };

  const policies = {
    load: async () => ({
      path: "AGENTS.md",
      rawInstructions: "",
    }),
  };

  const mutations = {
    apply: async (_proposal: EditProposal, mutableFile?: string) => {
      mutationCalls += 1;
      mutationTarget = mutableFile;
      return options.mutationResult ?? { ok: true as const };
    },
  };

  const state = baseState();
  const learningState = {
    load: async () => state,
    save: async (_next: LearningState) => {},
  };

  const controller = new LearningController(
    sessions,
    runtime,
    contexts,
    policies,
    mutations,
    learningState,
    { turnTimeoutMs: 50 },
  );

  return {
    controller,
    prompts,
    getMutationCalls: () => mutationCalls,
    getUserWrites: () => recordedUserMessages,
    getMutationTarget: () => mutationTarget,
    getProposalState: (id: string) => proposalRecords.get(id)?.state,
  };
}

test("failed practice evaluation rolls back to the same question", async () => {
  let call = 0;
  const fence = String.fromCharCode(96).repeat(3);

  const harness = createHarness(async function* () {
    call += 1;

    if (call === 1) {
      yield {
        type: "text",
        content:
          fence +
          "learning-practice\n" +
          JSON.stringify({
            kind: "question",
            concept: "transactions",
            question: "What makes a transaction atomic?",
          }) +
          "\n" +
          fence,
      };
      yield { type: "completed" };
      return;
    }

    if (call === 2) {
      yield {
        type: "failed",
        failure: {
          code: "process-failed",
          message: "runtime failed",
        },
      };
      return;
    }

    yield {
      type: "text",
      content:
        fence +
        "learning-practice\n" +
        JSON.stringify({
          kind: "evaluation",
          concept: "transactions",
          outcome: "partial",
          feedback: "retry accepted",
          misconceptions: [],
        }) +
        "\n" +
        fence,
    };
    yield { type: "completed" };
  });

  const first = await collectEvents(
    harness.controller.run({
      prompt: "quiz me",
      action: "practice",
      explicitContext: [],
    }),
  );

  assert.ok(
    first.some((event) => event.type === "practice-question"),
  );
  assert.equal(harness.controller.hasActivePracticeQuestion(), true);

  const failed = await collectEvents(
    harness.controller.run({
      prompt: "first answer",
      action: "practice",
      explicitContext: [],
    }),
  );

  assert.ok(failed.some((event) => event.type === "failed"));

  await collectEvents(
    harness.controller.run({
      prompt: "retry answer",
      action: "practice",
      explicitContext: [],
    }),
  );

  assert.match(
    harness.prompts[2] ?? "",
    /Learning mode: practice evaluation/,
  );
  assert.match(
    harness.prompts[2] ?? "",
    /What makes a transaction atomic\?/,
  );
  assert.match(harness.prompts[2] ?? "", /retry answer/);
});

test("practice state is isolated by conversation session and resumes when returning", async () => {
  let call = 0;
  const fence = String.fromCharCode(96).repeat(3);

  const harness = createHarness(async function* () {
    call += 1;

    if (call === 1) {
      yield {
        type: "text",
        content:
          fence +
          "learning-practice\n" +
          JSON.stringify({
            kind: "question",
            concept: "transactions",
            question: "What makes a transaction atomic?",
          }) +
          "\n" +
          fence,
      };
      yield { type: "completed" };
      return;
    }

    if (call === 2) {
      yield {
        type: "text",
        content:
          fence +
          "learning-practice\n" +
          JSON.stringify({
            kind: "question",
            concept: "indexes",
            question: "Why does index column order matter?",
          }) +
          "\n" +
          fence,
      };
      yield { type: "completed" };
      return;
    }

    yield {
      type: "text",
      content:
        fence +
        "learning-practice\n" +
        JSON.stringify({
          kind: "evaluation",
          concept: "transactions",
          outcome: "correct",
          feedback: "Correct.",
          misconceptions: [],
        }) +
        "\n" +
        fence,
    };
    yield { type: "completed" };
  });

  const firstSessionId = harness.controller.getSession().id;

  await collectEvents(
    harness.controller.run({
      prompt: "quiz transactions",
      action: "practice",
      explicitContext: [],
    }),
  );

  const secondSession = await harness.controller.newSession();

  await collectEvents(
    harness.controller.run({
      prompt: "quiz indexes",
      action: "practice",
      explicitContext: [],
    }),
  );

  assert.match(
    harness.prompts[1] ?? "",
    /Generate exactly one active-recall question/,
  );
  assert.doesNotMatch(
    harness.prompts[1] ?? "",
    /What makes a transaction atomic\?/,
  );

  await harness.controller.selectSession(firstSessionId);

  await collectEvents(
    harness.controller.run({
      prompt: "All-or-nothing effects",
      action: "practice",
      explicitContext: [],
    }),
  );

  assert.notEqual(secondSession.id, firstSessionId);
  assert.match(
    harness.prompts[2] ?? "",
    /Learning mode: practice evaluation/,
  );
  assert.match(
    harness.prompts[2] ?? "",
    /What makes a transaction atomic\?/,
  );
  assert.match(
    harness.prompts[2] ?? "",
    /All-or-nothing effects/,
  );
});

test("non-practice action resets only the active session practice", async () => {
  let call = 0;
  const fence = String.fromCharCode(96).repeat(3);

  const harness = createHarness(async function* (prompt) {
    call += 1;

    if (call === 1) {
      yield {
        type: "text",
        content:
          fence +
          "learning-practice\n" +
          JSON.stringify({
            kind: "question",
            concept: "transactions",
            question: "What makes a transaction atomic?",
          }) +
          "\n" +
          fence,
      };
      yield { type: "completed" };
      return;
    }

    if (call === 2) {
      yield { type: "text", content: "Plain answer" };
      yield { type: "completed" };
      return;
    }

    assert.match(prompt, /Learning mode: practice evaluation/);
    yield {
      type: "text",
      content:
        fence +
        "learning-practice\n" +
        JSON.stringify({
          kind: "evaluation",
          concept: "transactions",
          outcome: "correct",
          feedback: "Correct.",
          misconceptions: [],
        }) +
        "\n" +
        fence,
    };
    yield { type: "completed" };
  });

  const firstSessionId = harness.controller.getSession().id;

  await collectEvents(
    harness.controller.run({
      prompt: "quiz me",
      action: "practice",
      explicitContext: [],
    }),
  );

  await harness.controller.newSession();
  await collectEvents(
    harness.controller.run({
      prompt: "explain indexes",
      action: "ask",
      explicitContext: [],
    }),
  );

  await harness.controller.selectSession(firstSessionId);
  await collectEvents(
    harness.controller.run({
      prompt: "All-or-nothing effects",
      action: "practice",
      explicitContext: [],
    }),
  );

  assert.match(
    harness.prompts[2] ?? "",
    /What makes a transaction atomic\?/,
  );
});

test("proposal applicability comes from canonical session state", async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const harness = createHarness(async function* () {
    yield {
      type: "text",
      content:
        fence +
        "edit-proposal\n" +
        JSON.stringify({
          file: "note.md",
          original: "current",
          replacement: "next",
          reason: "clarify",
        }) +
        "\n" +
        fence,
    };
    yield { type: "completed" };
  });

  const events = await collectEvents(
    harness.controller.run({
      prompt: "fix this",
      action: "edit",
      explicitContext: [],
    }),
  );

  const proposal = events.find(
    (event) => event.type === "mutation-proposed",
  );
  assert.ok(proposal && proposal.type === "mutation-proposed");
  assert.equal(
    harness.getProposalState(proposal.edit.id),
    "pending",
  );

  const result = await harness.controller.applyProposal(proposal.edit.id);

  assert.equal(result.ok, true);
  assert.equal(harness.getMutationCalls(), 1);
  assert.equal(harness.getMutationTarget(), "note.md");
  assert.equal(
    harness.getProposalState(proposal.edit.id),
    "applied",
  );
});

test("new session invalidates canonical pending edit proposals", async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const harness = createHarness(async function* () {
    yield {
      type: "text",
      content:
        fence +
        "edit-proposal\n" +
        JSON.stringify({
          file: "note.md",
          original: "current",
          replacement: "next",
        }) +
        "\n" +
        fence,
    };
    yield { type: "completed" };
  });

  const events = await collectEvents(
    harness.controller.run({
      prompt: "fix this",
      action: "edit",
      explicitContext: [],
    }),
  );
  const proposal = events.find(
    (event) => event.type === "mutation-proposed",
  );
  assert.ok(proposal && proposal.type === "mutation-proposed");

  await harness.controller.newSession();

  const result = await harness.controller.applyProposal(proposal.edit.id);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "stale");
  assert.equal(harness.getMutationCalls(), 0);
});

test("context preparation failures become recoverable learning failures", async () => {
  const controller = new LearningController(
    {
      getSession: () => ({
        id: "s",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }),
      listSessions: () => [],
      selectSession: async () => null,
      setModel: async () => {},
      newSession: async () => ({
        id: "s2",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }),
      recordUserMessage: async () => {},
      setConversationId: async () => {},
      recordAssistantMessage: async () => {},
      recordProposal: async () => {},
      getProposal: () => null,
      updateProposalState: async () => {},
    },
    {
      check: async () => ({ status: "ready" as const }),
      getModels: () => [],
      send: async function* () {
        yield { type: "completed" as const };
      },
    },
    {
      resolve: async () => {
        throw new Error("missing explicit note");
      },
      searchNotes: () => [],
      toAgentContext: () => [],
    },
    {
      load: async () => ({
        path: "AGENTS.md",
        rawInstructions: "",
      }),
    },
    {
      apply: async () => ({ ok: true as const }),
    },
    {
      load: async () => baseState(),
      save: async (_next: LearningState) => {},
    },
  );

  const events = await collectEvents(
    controller.run({
      prompt: "hello",
      action: "ask",
      explicitContext: [],
    }),
  );

  assert.deepEqual(events.map((event) => event.type), ["failed"]);

  const failed = events[0];
  assert.equal(failed?.type, "failed");
  if (failed?.type === "failed") {
    assert.equal(failed.failure.code, "unknown");
    assert.match(
      failed.failure.diagnostic ?? "",
      /missing explicit note/,
    );
  }
});


test("active turn locks session transitions during context preparation and streaming", async () => {
  const harness = createHarness(async function* () {
    yield { type: "text", content: "answer" };
    yield { type: "completed" };
  });

  const iterator = harness.controller.run({
    prompt: "hello",
    action: "ask",
    explicitContext: [],
  })[Symbol.asyncIterator]();

  const first = await iterator.next();
  assert.equal(first.value?.type, "context-ready");
  await assert.rejects(() => harness.controller.newSession(), /active turn/);
  await assert.rejects(
    () => harness.controller.selectSession("session-1"),
    /active turn/,
  );

  while (!(await iterator.next()).done) {
    // Drain and release the turn lock.
  }
  const newSession = await harness.controller.newSession();
  assert.equal(newSession.id, "session-2");
});

test("retry does not persist the logical user message a second time", async () => {
  const harness = createHarness(async function* () {
    yield { type: "text", content: "answer" };
    yield { type: "completed" };
  });
  const request = { prompt: "Explain transactions", action: "ask" as const, explicitContext: [] };
  await collectEvents(harness.controller.run(request));
  await collectEvents(harness.controller.run({ ...request, retry: true }));
  assert.equal(harness.getUserWrites(), 1);
});

test("recoverable missing editor keeps proposal pending for retry", async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const harness = createHarness(async function* () {
    yield { type: "text", content: fence + "edit-proposal\n" +
      JSON.stringify({ file: "note.md", original: "current", replacement: "next" }) +
      "\n" + fence };
    yield { type: "completed" };
  }, { mutationResult: { ok: false, reason: "no-editor", message: "Open the note." } });
  const events = await collectEvents(harness.controller.run({
    prompt: "improve",
    action: "edit",
    explicitContext: [],
  }));
  const proposal = events.find(event => event.type === "mutation-proposed");
  assert.ok(proposal && proposal.type === "mutation-proposed");
  const result = await harness.controller.applyProposal(proposal.edit.id);
  assert.deepEqual(result, { ok: false, reason: "no-editor", message: "Open the note." });
  assert.equal(harness.getProposalState(proposal.edit.id), "pending");
});

test("review edit follow-up refuses a different active note", async () => {
  const harness = createHarness(async function* () {
    yield { type: "completed" };
  });
  const events = await collectEvents(harness.controller.run({
    prompt: "fix finding",
    action: "edit",
    explicitContext: [],
    sourcePath: "another-note.md",
  }));
  assert.equal(events[0]?.type, "failed");
  if (events[0]?.type === "failed") {
    assert.match(events[0].failure.message, /Open another-note\.md/);
  }
});
