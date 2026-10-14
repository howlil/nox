import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentContext,
  AgentStreamEvent,
  type AgentTurnMetrics,
  ApplyResult,
  ChatSession,
  EditProposal,
} from "../../src/types";
import { LearningController } from "../../src/application/LearningController";
import { LearningState } from "../../src/domain/learning-state/types";
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
  options: {
    mutationResult?: ApplyResult;
    mutationGate?: Promise<void>;
    contextOverride?: { activeNote: { path: string; content: string }; explicit: Array<{ type: "note"; path: string; content: string; source: "explicit" }> };
    agentContexts?: AgentContext[];
    learningSaveFailures?: number;
    evaluationTranscriptFailures?: number;
    programTimer?: { beginAiWait(id: string): Promise<boolean>; isPlanning(): boolean };
  } = {},
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
  const sentContexts: AgentContext[][] = [];
  let mutationCalls = 0;
  let mutationTarget: string | undefined;
  let recordedUserMessages = 0;
  const structuredParts: Array<{ type: string; questionId?: string }> = [];
  let transcriptFailures = options.evaluationTranscriptFailures ?? 0;

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
    recordPracticeHint: async (hint: string) => {
      session.messages.push(
        { role: "user", content: "/hint", action: "practice" },
        { role: "assistant", content: "Hint: " + hint },
      );
    },
    setConversationId: async (_id?: string) => {},
    recordAssistantMessage: async (
      content: string,
      sourcePath?: string,
      _sessionId?: string,
      thought?: string,
      elapsedMs?: number,
      metrics?: AgentTurnMetrics,
    ) => {
      session.messages.push({
        role: "assistant",
        content,
        sourcePath,
        thought,
        elapsedMs,
        metrics,
      });
    },
    recordStructuredPart: async (part: { type: string; questionId?: string }) => {
      if (part.type === "practice-evaluation" && transcriptFailures-- > 0) {
        throw new Error("Simulated session persistence failure");
      }
      if (!part.questionId ||
        !structuredParts.some((previous) =>
          previous.type === part.type && previous.questionId === part.questionId)) {
        structuredParts.push(part);
      }
    },
    recordPracticeOutcome: async (
      parts: Array<{ type: string; questionId?: string; evaluation?: unknown }>,
    ) => {
       if (options.evaluationTranscriptFailures && transcriptFailures-- > 0) {
        throw new Error("Simulated session persistence failure");
      }
      const evaluation = parts.find((part) => part.type === "practice-evaluation");
      const existing = evaluation?.questionId && structuredParts.some((part) =>
        part.type === "practice-evaluation" && part.questionId === evaluation.questionId);
      if (existing && evaluation) {
        const prior = session.messages.find((message) => message.parts?.some((part) =>
          part.type === "practice-evaluation" && part.questionId === evaluation.questionId));
        return prior?.parts ?? parts;
      }
      structuredParts.push(...parts);
      session.messages.push({ role: "assistant", content: "", parts: parts as ChatSession["messages"][number]["parts"] });
      return parts;
    },
    recordReviewOutcome: async (
      part: { type: "review-findings"; reviewId?: string; findings: unknown[]; sourcePath?: string },
    ) => {
      const existing = session.messages.flatMap((message) => message.parts ?? [])
        .find((entry) => entry.type === "review-findings" && entry.reviewId === part.reviewId);
      if (existing && existing.type === "review-findings") return existing;
      session.messages.push({ role: "assistant", content: "",
        parts: [part as ChatSession["messages"][number]["parts"] extends (infer T)[] ? T : never] });
      return part;
    },
    recordEditOutcome: async (
      id: string,
      proposal: EditProposal,
      narrative: string,
      mutableFile: string,
    ) => {
      const existing = proposalRecords.get(id);
      if (existing) {
        return { proposal: existing.proposal, state: existing.state };
      }
      if (narrative.trim()) {
        session.messages.push({ role: "assistant", content: narrative, sourcePath: mutableFile });
      }
      const record = { proposal, mutableFile, state: "pending" as const };
      proposalRecords.set(id, record);
      session.messages.push({
        role: "assistant", content: "", proposalId: id, proposal,
        proposalMutableFile: mutableFile, proposalState: "pending",
      });
      return { proposal, state: "pending" as const };
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
      input: { prompt: string; context: AgentContext[] },
      _opts: unknown,
      signal: AbortSignal,
    ) {
      prompts.push(input.prompt);
      sentContexts.push(input.context);
      yield* sendTurn(input.prompt, signal);
    },
  };

  const contexts = {
    resolve: async () => options.contextOverride ?? ({
      activeNote: {
        path: "note.md",
        content: "current note",
      },
      explicit: [],
    }),
    searchNotes: () => [],
    toAgentContext: () => options.agentContexts ?? [
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
      if (options.mutationGate) await options.mutationGate;
      return options.mutationResult ?? { ok: true as const };
    },
  };

  let state = baseState();
  let saveFailures = options.learningSaveFailures ?? 0;
  const learningState = {
    load: async () => state,
    save: async (next: LearningState) => {
      if (saveFailures-- > 0) throw new Error("Simulated vault persistence failure");
      state = next;
    },
  };

  const controller = new LearningController(
    sessions,
    runtime,
    contexts,
    policies,
    mutations,
    learningState,
    { turnTimeoutMs: 50 },
    options.programTimer as never,
  );

  return {
    controller,
    prompts,
    getSentContexts: () => sentContexts,
    getMutationCalls: () => mutationCalls,
    getUserWrites: () => recordedUserMessages,
    getMutationTarget: () => mutationTarget,
    getProposalState: (id: string) => proposalRecords.get(id)?.state,
    getStructuredParts: () => structuredParts,
    getEvidence: () => state.evidence,
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
      recordPracticeHint: async () => {},
      setConversationId: async () => {},
      recordAssistantMessage: async () => {},
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

test("review practice follow-up uses the pinned source instead of newly active note", async () => {
  const harness = createHarness(async function* () {
    yield { type: "completed" };
  }, {
    contextOverride: {
      activeNote: { path: "other.md", content: "unrelated material" },
      explicit: [
        { type: "note", path: "source.md", content: "original reviewed material", source: "explicit" },
      ],
    },
    agentContexts: [
      { type: "note", file: "other.md", content: "unrelated material" },
      { type: "note", file: "source.md", content: "original reviewed material" },
    ],
  });
  await collectEvents(harness.controller.run({
    prompt: "Practice the finding",
    action: "practice",
    explicitContext: [],
    sourcePath: "source.md",
  }));
  const context = harness.getSentContexts()[0] ?? [];
  assert.equal(context[0]?.file, "source.md");
  assert.equal(context.some((item) => item.file === "other.md"), false);
});

test("practice evidence remains consistent when vault persistence fails then user retries", async () => {
  const fence = "```";
  let calls = 0;
  const harness = createHarness(async function* () {
    calls++;
    const payload = calls === 1
      ? { kind: "question", concept: "atomicity", question: "Define atomicity." }
      : { kind: "evaluation", concept: "atomicity", outcome: "correct",
          feedback: "Correct", misconceptions: [] };
    yield { type: "text", content: fence + "learning-practice\n" +
      JSON.stringify(payload) + "\n" + fence };
    yield { type: "completed" };
  }, { learningSaveFailures: 1 });

  await collectEvents(harness.controller.run({
    prompt: "Practice", action: "practice", explicitContext: [],
  }));
  const failed = await collectEvents(harness.controller.run({
    prompt: "All or nothing", action: "practice", explicitContext: [],
  }));
  assert.ok(failed.some((event) => event.type === "failed"));
  assert.equal(harness.controller.hasActivePracticeQuestion(), true);
  assert.equal(harness.getEvidence().length, 0);
  // Canonical evaluation is durable, but its learning evidence is not yet projected.
  assert.equal(harness.getStructuredParts().filter((part) => part.type === "practice-evaluation").length, 1);

  const recovered = await collectEvents(harness.controller.run({
    prompt: "All or nothing", action: "practice", explicitContext: [],
  }));
  assert.ok(recovered.some((event) => event.type === "practice-evaluation"));
  assert.equal(harness.getEvidence().length, 1);
  assert.equal(calls, 2, "retry must not ask the model to grade again");
});

test("transcript failure occurs before evidence mutation and retry can regrade", async () => {
  const fence = "```";
  let calls = 0;
  const harness = createHarness(async function* () {
    calls++;
    const payload = calls === 1
      ? { kind: "question", concept: "isolation", question: "What is isolation?" }
      : { kind: "evaluation", concept: "isolation", outcome: "partial",
          feedback: "Incomplete", misconceptions: ["concurrency"] };
    yield { type: "text", content: fence + "learning-practice\n" +
      JSON.stringify(payload) + "\n" + fence };
    yield { type: "completed" };
  }, { evaluationTranscriptFailures: 1 });
  await collectEvents(harness.controller.run({
    prompt: "Practice", action: "practice", explicitContext: [],
  }));
  const failed = await collectEvents(harness.controller.run({
    prompt: "first answer", action: "practice", explicitContext: [],
  }));
  assert.ok(failed.some((event) => event.type === "failed"));
  assert.equal(harness.controller.hasActivePracticeQuestion(), true);
  assert.equal(harness.getEvidence().length, 0);

  const recovered = await collectEvents(harness.controller.run({
    prompt: "first answer", action: "practice", explicitContext: [],
  }));
  assert.ok(recovered.some((event) => event.type === "practice-evaluation"));
  assert.equal(harness.getEvidence().length, 1);
  assert.equal(harness.getStructuredParts().filter((part) => part.type === "practice-evaluation").length, 1);
});

test("practice evaluation stays grounded in the question origin after navigating to another note", async () => {
  const fence = "```";
  let turn = 0;
  const context = {
    activeNote: { path: "note-a.md", content: "Atomic transaction notes" },
    explicit: [] as Array<{ type: "note"; path: string; content: string; source: "explicit" }>,
  };
  const options = {
    contextOverride: context,
    agentContexts: [{ type: "note" as const, file: "note-a.md", content: "Atomic transaction notes" }],
  };
  const harness = createHarness(async function* () {
    turn++;
    const payload = turn === 1
      ? { kind: "question", concept: "transactions", question: "What is atomicity?" }
      : { kind: "evaluation", concept: "transactions", outcome: "correct",
          feedback: "Correct", misconceptions: [] };
    yield { type: "text", content: fence + "learning-practice\n" +
      JSON.stringify(payload) + "\n" + fence };
    yield { type: "completed" };
  }, options);

  await collectEvents(harness.controller.run({
    prompt: "Practice atomicity", action: "practice", explicitContext: [],
  }));
  context.activeNote.path = "note-b.md";
  context.activeNote.content = "Unrelated content";
  context.explicit.push({
    type: "note", path: "note-a.md",
    content: "Atomic transaction notes", source: "explicit",
  });
  options.agentContexts = [
    { type: "note", file: "note-b.md", content: "Unrelated content" },
    { type: "note", file: "note-a.md", content: "Atomic transaction notes" },
  ];
  await collectEvents(harness.controller.run({
    prompt: "All or nothing", action: "practice", explicitContext: [],
  }));
  const sent = harness.getSentContexts()[1] ?? [];
  assert.equal(sent[0]?.file, "note-a.md");
  assert.equal(sent.some((part) => part.file === "note-b.md"), false);
  assert.equal(harness.getEvidence()[0]?.source, "note-a.md");
});

// Canonical transcript can outlive a failed evidence projection. Even if a
// subsequent agent reply would disagree, recovery must replay the first verdict.
test("different second model verdict cannot replace a committed practice evaluation", async () => {
  const fence = "```";
  let calls = 0;
  const h = createHarness(async function* () {
    calls++;
    const payload = calls === 1
      ? { kind: "question", concept: "atomicity", question: "What is atomicity?" }
      : calls === 2
        ? { kind: "evaluation", concept: "atomicity", outcome: "correct",
            feedback: "Correct result", misconceptions: [] }
        : { kind: "evaluation", concept: "atomicity", outcome: "incorrect",
            feedback: "Conflicting result", misconceptions: ["misconception"] };
    yield { type: "text", content: fence + "learning-practice\n" + JSON.stringify(payload) + "\n" + fence };
    yield { type: "completed" };
  }, { learningSaveFailures: 1 });
  await collectEvents(h.controller.run({
    prompt: "Practice", action: "practice", explicitContext: [],
  }));
  const failed = await collectEvents(h.controller.run({
    prompt: "All or nothing", action: "practice", explicitContext: [],
  }));
  assert.ok(failed.some((event) => event.type === "failed"));
  const restored = await collectEvents(h.controller.run({
    prompt: "All or nothing", action: "practice", explicitContext: [], retry: true,
  }));
  assert.equal(calls, 2, "second agent verdict must never be requested");
  assert.equal(h.getEvidence()[0]?.outcome, "correct");
  assert.equal(restored.find((event) => event.type === "practice-evaluation")?.type, "practice-evaluation");
});

test("partial Review output is not committed and a retried Review is idempotent", async () => {
  const fence = "```";
  let calls = 0;
  const h = createHarness(async function* () {
    calls++;
    yield { type: "text", content: fence + "learning-review\n" + JSON.stringify({
      kind: "review",
      findings: [{ kind: "missing-relation", concept: "SQL",
        title: "Isolation", detail: "Explain visibility" }],
    }) + "\n" + fence };
    if (calls === 1) {
      yield { type: "failed", failure: { code: "process-failed", message: "agent crashed" } };
    } else {
      yield { type: "completed" };
    }
  });
  const request = {
    prompt: "Review note", action: "review" as const,
    turnId: "stable-review", explicitContext: [],
  };
  const failed = await collectEvents(h.controller.run(request));
  assert.ok(failed.some((e) => e.type === "failed"));
  assert.equal(failed.some((e) => e.type === "review-findings"), false);
  assert.equal(h.getEvidence().length, 0);

  const completed = await collectEvents(h.controller.run({ ...request, retry: true }));
  assert.ok(completed.some((e) => e.type === "review-findings"));
  assert.equal(h.getEvidence().length, 1);
  assert.equal(h.getEvidence()[0]?.id, "review:session-1:stable-review:0");

  const repeated = await collectEvents(h.controller.run({ ...request, retry: true }));
  assert.ok(repeated.some((e) => e.type === "completed"));
  assert.equal(calls, 2, "committed Review must not invoke the agent again");
  assert.equal(h.getEvidence().length, 1);
});


test("in-flight Apply blocks navigation and conflicting proposal actions", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fence = String.fromCharCode(96).repeat(3);
  const harness = createHarness(async function* () {
    yield { type: "text", content: fence + "edit-proposal\n" +
      JSON.stringify({ file: "note.md", original: "current", replacement: "next" }) +
      "\n" + fence };
    yield { type: "completed" };
  }, { mutationGate: gate });
  const events = await collectEvents(harness.controller.run({
    prompt: "Fix this", action: "edit", explicitContext: [],
  }));
  const proposed = events.find((item) => item.type === "mutation-proposed");
  assert.ok(proposed && proposed.type === "mutation-proposed");
  const originalSession = harness.controller.getSession().id;

  const applying = harness.controller.applyProposal(proposed.edit.id);
  await Promise.resolve();
  await assert.rejects(harness.controller.newSession(), /active turn or note edit/);
  await assert.rejects(harness.controller.selectSession(originalSession), /active turn or note edit/);
  await assert.rejects(harness.controller.rejectProposal(proposed.edit.id), /active note edit/);
  const repeated = await harness.controller.applyProposal(proposed.edit.id);
  assert.equal(repeated.ok, false);
  assert.equal(harness.getMutationCalls(), 1);

  release();
  const applied = await applying;
  assert.equal(applied.ok, true);
  assert.equal(harness.getProposalState(proposed.edit.id), "applied");
  assert.equal(harness.controller.getSession().id, originalSession);
  await harness.controller.newSession();
});

test("streams thought-delta from <think> tags and persists thought on assistant message", async () => {
  const harness = createHarness(async function* () {
    yield { type: "text", content: "<think>Step 1 reasoning\nStep 2 reasoning</think>Here is the final answer" };
    yield { type: "completed" };
  });

  const events = await collectEvents(harness.controller.run({
    prompt: "Why?", action: "ask", explicitContext: [],
  }));

  const thoughtEvents = events.filter((e) => e.type === "thought-delta");
  const responseEvents = events.filter((e) => e.type === "response-delta");

  assert.ok(thoughtEvents.length > 0);
  const totalThought = thoughtEvents.map((e) => (e as { text: string }).text).join("");
  assert.equal(totalThought, "Step 1 reasoning\nStep 2 reasoning");

  assert.ok(responseEvents.length > 0);
  const totalResponse = responseEvents.map((e) => (e as { text: string }).text).join("");
  assert.equal(totalResponse, "Here is the final answer");

  const message = harness.controller.getSession().messages.find((m) => m.role === "assistant");
  assert.equal(message?.content, "Here is the final answer");
  assert.equal(message?.thought, "Step 1 reasoning\nStep 2 reasoning");
  assert.ok(typeof message?.elapsedMs === "number");
});

test("run activity is based on observed output and records full turn timings", async () => {
  const harness = createHarness(async function* () {
    yield { type: "text", content: "first" };
    yield { type: "text", content: " second" };
    yield { type: "completed" };
  });
  const events = await collectEvents(harness.controller.run({
    prompt: "explain a race condition", action: "ask", explicitContext: [],
  }));
  const phases = events.filter((event) => event.type === "activity-phase");
  assert.deepEqual(phases.map((event) =>
    event.type === "activity-phase" ? event.phase : undefined),
  ["waiting-model", "receiving-output", "finalizing"]);
  assert.ok(phases.every((event) => event.type !== "activity-phase" || Number.isFinite(event.at)));
  const result = harness.controller.getSession().messages.find((message) =>
    message.role === "assistant" && message.content.includes("first"));
  assert.equal(result?.content, "first second");
  assert.ok(result?.metrics);
  assert.ok(result.metrics.contextMs !== undefined && result.metrics.contextMs >= 0);
  assert.ok(result.metrics.preparationMs !== undefined &&
    result.metrics.preparationMs >= result.metrics.contextMs);
  assert.ok(result.metrics.firstVisibleMs !== undefined &&
    result.metrics.firstVisibleMs >= 0);
  assert.ok(result.metrics.elapsedMs >= result.metrics.firstVisibleMs);
});

test("failed inference never announces a finalizing phase", async () => {
  const harness = createHarness(async function* () {
    yield { type: "failed", failure: { code: "process-failed", message: "Offline" } };
  });
  const events = await collectEvents(harness.controller.run({
    prompt: "explain a race condition", action: "ask", explicitContext: [],
  }));
  assert.deepEqual(events.filter((event) => event.type === "activity-phase").map(
    (event) => event.type === "activity-phase" ? event.phase : undefined,
  ), ["waiting-model"]);
  assert.ok(events.some((event) => event.type === "failed"));
});

test("typed MCQ card submission uses deterministic grader and creates exactly one evidence record", async () => {
  const fence = "```";
  let providerCalls = 0;
  const question = {
    kind: "question", concept: "IoC", question: "Which dependency is injected?",
    input: { type: "multiple-choice", options: [
      { id: "a", text: "Hardcoded class" },
      { id: "b", text: "Constructor parameter" },
    ], correctOptionId: "b", explanation: "Constructor injection decouples construction." },
  };
  const h = createHarness(async function* () {
    providerCalls++;
    yield { type: "text", content: fence + "learning-practice\n" +
      JSON.stringify(question) + "\n" + fence };
    yield { type: "completed" };
  });
  const generated = await collectEvents(h.controller.run({
    prompt: "MCQ about IoC", action: "practice", explicitContext: [],
  }));
  const card = generated.find(e => e.type === "practice-question");
  assert.ok(card?.type === "practice-question" && card.questionId);
  assert.equal(h.controller.hasActivePracticeQuestion(), true);
  const id = card.questionId;
  const marked = await collectEvents(h.controller.run({
    prompt: "Selected option: b", action: "practice", explicitContext: [],
    practiceSubmission: { questionId: id, answer: { type: "multiple-choice", optionId: "b" } },
  }));
  assert.equal(marked.find(e => e.type === "practice-evaluation")?.evaluation.outcome, "correct");
  assert.equal(marked.at(-1)?.type, "completed");
  assert.equal(providerCalls, 1);
  assert.equal(h.getEvidence().length, 1);
  const duplicate = await collectEvents(h.controller.run({
    prompt: "Selected option: b", action: "practice", explicitContext: [],
    practiceSubmission: { questionId: id, answer: { type: "multiple-choice", optionId: "b" } },
  }));
  assert.equal(duplicate.at(-1)?.type, "failed");
  assert.equal(h.getEvidence().length, 1);
});

test("typed code answer keeps review-only constraints and criteria through the model evaluation", async () => {
  const fence = "```";
  let calls = 0;
  const h = createHarness(async function* () {
    calls++;
    if (calls === 1) yield { type: "text", content: fence + "learning-practice\n" +
      JSON.stringify({ kind: "question", concept: "DI", question: "Implement DI.",
        input: { type: "code", language: "java", criteria: ["Constructor injection"],
          executionMode: "review-only", starterCode: "class Service {}" } }) +
      "\n" + fence };
    else yield { type: "text", content: fence + "learning-practice\n" +
      JSON.stringify({ kind: "evaluation", concept: "DI", outcome: "correct",
        feedback: "Constructor injection is correct.", misconceptions: [] }) +
      "\n" + fence };
    yield { type: "completed" };
  });
  const generated = await collectEvents(h.controller.run({
    prompt: "code exercise", action: "practice", explicitContext: [],
  }));
  const item = generated.find(e => e.type === "practice-question");
  assert.ok(item?.type === "practice-question" && item.questionId);
  const completed = await collectEvents(h.controller.run({
    prompt: "Code answer", action: "practice", explicitContext: [],
    practiceSubmission: { questionId: item.questionId,
      answer: { type: "code", language: "java", source: "class Service { Service(Repo r) {} }" } },
  }));
  assert.equal(completed.find(e => e.type === "practice-evaluation")?.evaluation.outcome, "correct");
  assert.match(h.prompts[1] ?? "", /Review only; do not claim code execution/);
  assert.match(h.prompts[1] ?? "", /Constructor injection/);
  assert.equal(h.getEvidence().length, 1);
});

test("malformed learning program data cannot prevent an unrelated chat turn", async () => {
  const harness = createHarness(async function* () {
    yield { type: "text", content: "Hello from the agent." };
    yield { type: "completed" };
  }, {
    programTimer: {
      beginAiWait: async () => { throw new Error("Invalid NOX programs JSON."); },
      isPlanning: () => false,
    },
  });
  const events = await collectEvents(harness.controller.run({
    prompt: "Explain Java Spring", action: "ask", explicitContext: [],
  }));
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(harness.prompts.length, 1);
});

test("learning-specific practice remains blocked when program storage is invalid", async () => {
  const harness = createHarness(async function* () {
    yield { type: "text", content: "Should not invoke agent" };
    yield { type: "completed" };
  }, {
    programTimer: {
      beginAiWait: async () => { throw new Error("Invalid NOX programs JSON."); },
      isPlanning: () => false,
    },
  });
  const events = await collectEvents(harness.controller.run({
    prompt: "Practice my curriculum", action: "practice", explicitContext: [],
  }));
  assert.ok(events.some(event => event.type === "failed"));
  assert.equal(harness.prompts.length, 0);
});
