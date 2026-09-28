import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentStreamEvent,
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
) {
  let session: ChatSession = {
    id: "session-1",
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };

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

  const sessions = {
    getSession: () => session,
    listSessions: () => [session],
    selectSession: async (_id: string) => session,
    setModel: async (_model?: string) => {},
    newSession: async () => {
      for (const record of proposalRecords.values()) {
        if (record.state === "pending") record.state = "stale";
      }
      session = {
        id: "session-2",
        messages: [],
        createdAt: 2,
        updatedAt: 2,
      };
      return session;
    },
    recordUserMessage: async (_content: string) => {},
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
      return { ok: true as const };
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
