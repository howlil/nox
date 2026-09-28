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
  const session: ChatSession = {
    id: "session-1",
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };

  const prompts: string[] = [];
  let mutationCalls = 0;

  const sessions = {
    checkRuntime: async () => ({ status: "ready" as const }),
    getSession: () => session,
    getModels: () => [],
    setModel: (_model?: string) => {},
    newSession: async () => ({
      ...session,
      id: "session-2",
      messages: [],
    }),
    sendTurn: async function* (
      prompt: string,
      _context: unknown[],
      _displayPrompt: string,
      signal: AbortSignal,
    ) {
      prompts.push(prompt);
      yield* sendTurn(prompt, signal);
    },
    recordAssistantMessage: async (_content: string) => {},
    recordProposal: async (
      _id: string,
      _proposal: EditProposal,
    ) => {},
    updateProposalState: async () => {},
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
    apply: async () => {
      mutationCalls += 1;
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

test("new session invalidates pending edit proposals", async () => {
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

  assert.ok(
    proposal && proposal.type === "mutation-proposed",
  );

  await harness.controller.newSession();

  const result = await harness.controller.applyProposal(
    proposal.edit.id,
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "stale");
  }
  assert.equal(harness.getMutationCalls(), 0);
});

test("context preparation failures become recoverable learning failures", async () => {
  const controller = new LearningController(
    {
      checkRuntime: async () => ({ status: "ready" as const }),
      getSession: () => ({
        id: "s",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }),
      getModels: () => [],
      setModel: () => {},
      newSession: async () => ({
        id: "s2",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }),
      sendTurn: async function* () {
        yield { type: "completed" as const };
      },
      recordAssistantMessage: async () => {},
      recordProposal: async () => {},
      updateProposalState: async () => {},
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

  assert.deepEqual(events.map((event) => event.type), [
    "failed",
  ]);

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
