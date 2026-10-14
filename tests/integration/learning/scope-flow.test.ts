import assert from "node:assert/strict";
import test from "node:test";
import { LearningController } from "../../../src/application/LearningController";
import { SessionController } from "../../../src/session/SessionController";
import { SessionStore } from "../../../src/session/SessionStore";
import { PluginDataRepository } from "../../../src/persistence/PluginDataRepository";
import type { AgentStreamEvent } from "../../../src/types";
import type { LearningState } from "../../../src/domain/learning-state/types";
import { collectEvents } from "../../support/collect-events";

const block = (tag: string, value: object) => "```" + tag + "\n" + JSON.stringify(value) + "\n```";
const question = { kind: "question", concept: "HTTP", question: "What makes an HTTP method idempotent?" };
const evaluation = { kind: "evaluation", concept: "HTTP", outcome: "correct", feedback: "Repeated calls have the same effect.", misconceptions: [] };
const output = (outcome: string, value?: object, text = ""): AgentStreamEvent[] => [
  { type: "text", content: text + block("learning-scope", { outcome }) + (value ? block("learning-practice", value) : "") },
  { type: "completed", conversationId: "untrusted-scoped-history" },
];

async function rig(options: { turnTimeoutMs?: number } = {}) {
  let data: Record<string, unknown> | null = null;
  let failSave = false;
  let failQuestions = false;
  let state: LearningState = { version: 2, target: null, gaps: [], evidence: [] };
  const queue: Array<AgentStreamEvent[] | ((signal: AbortSignal) => AsyncIterable<AgentStreamEvent>)> = [];
  let mutation: () => Promise<{ ok: true }> = async () => { throw new Error("unexpected edit"); };
  const calls: Array<{ prompt: string; conversationId?: string }> = [];
  const create = async () => {
    const sessions = new SessionController(new PluginDataRepository({
      loadData: async () => structuredClone(data),
      saveData: async (next: Record<string, unknown>) => {
        if (failSave) throw new Error("disk unavailable");
        if (failQuestions && JSON.stringify(next).includes('"type":"practice-question"')) throw new Error("question write failed");
        data = structuredClone(next);
      },
    } as never), new SessionStore());
    await sessions.init();
    const learning = new LearningController(sessions, {
      check: async () => ({ status: "ready" as const }), getModels: () => [],
      send: async function* (input, options, signal) {
        calls.push({ prompt: input.prompt, conversationId: options.conversationId });
        const events = queue.shift();
        assert.ok(events, "unexpected runtime invocation");
        yield* typeof events === "function" ? events(signal) : events;
      },
    }, {
      resolve: async () => ({ explicit: [] }), searchNotes: () => [], toAgentContext: () => [],
    }, { load: async () => ({ path: "AGENTS.md", rawInstructions: "" }) }, {
      apply: async () => mutation(),
    }, { load: async () => structuredClone(state), save: async (next) => { state = structuredClone(next); } }, options);
    return { sessions, learning, send: (prompt: string, action = "ask") => collectEvents(learning.run({
      prompt, action: action as "ask", explicitContext: [], turnId: crypto.randomUUID(),
    })) };
  };
  return { ...await create(), restart: create, queue, calls, evidence: () => state.evidence,
    failSave: (value: boolean) => { failSave = value; }, failQuestions: () => { failQuestions = true; },
    mutateWith: (operation: typeof mutation) => { mutation = operation; } };
}

test("new sessions stay free; exact commands persist mode without an LLM call", async () => {
  const r = await rig();
  assert.equal(r.sessions.getSession().learningScope?.mode ?? "FREE", "FREE");
  const events = await r.send("/mode assessment");
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(r.sessions.getSession().learningScope?.mode, "BASELINE_ASSESSMENT");
  assert.equal(r.calls.length, 0);
  const restored = await r.restart();
  assert.equal(restored.sessions.getSession().learningScope?.mode, "BASELINE_ASSESSMENT");
});

test("OOS output cannot leak narrative, evaluate an answer, or advance the active question", async () => {
  const r = await rig();
  await r.send("/mode assessment");
  r.queue.push(output("answer", question));
  assert.ok((await r.send("Start")).some((e) => e.type === "practice-question"));
  r.queue.push(output("out-of-scope", evaluation, "Here is a long product design roadmap."));
  const events = await r.send("Let's discuss product design instead");
  const text = events.filter((e) => e.type === "response-delta").map((e) => e.text).join("");
  assert.match(text, /di luar scope backend/);
  assert.ok(text.includes(question.question));
  assert.ok(!text.includes("roadmap"));
  assert.ok(!events.some((e) => e.type === "practice-evaluation"));
  assert.equal(r.evidence().length, 0);
  assert.equal(r.learning.hasActivePracticeQuestion(), true);
  assert.equal(r.sessions.getSession().learningScope?.mode, "BASELINE_ASSESSMENT");
});

test("pause, free discussion, restart, and resume retain the exact scoped question", async () => {
  const r = await rig();
  await r.send("/mode focused");
  r.queue.push(output("answer", question));
  await r.send("Start");
  await r.send("/pause");
  assert.equal(r.learning.hasActivePracticeQuestion(), false);
  r.queue.push([{ type: "text", content: "A free discussion." }, { type: "completed" }]);
  await r.send("Product design please");
  const restored = await r.restart();
  await restored.send("/resume");
  assert.equal(restored.sessions.getSession().learningScope?.mode, "FOCUSED_LEARNING");
  assert.equal(restored.learning.hasActivePracticeQuestion(), true);
  r.queue.push(output("answer", evaluation));
  const events = await restored.send("Repeated calls have the same effect");
  assert.ok(events.some((e) => e.type === "practice-evaluation"));
  assert.equal(r.evidence().length, 1);
  assert.ok(r.calls.at(-1)!.prompt.includes(question.question));
  assert.equal(r.calls.at(-1)!.conversationId, undefined);
});

test("failed mode persistence does not unlock the session in memory or after restart", async () => {
  const r = await rig();
  await r.send("/mode assessment");
  r.failSave(true);
  const events = await r.send("/pause");
  assert.equal(events.at(-1)?.type, "failed");
  assert.equal(r.sessions.getSession().learningScope?.mode, "BASELINE_ASSESSMENT");
  r.failSave(false);
  const restored = await r.restart();
  assert.equal(restored.sessions.getSession().learningScope?.mode, "BASELINE_ASSESSMENT");
});

for (const [name, response] of Object.entries({
  missing: block("learning-practice", evaluation),
  duplicate: block("learning-scope", { outcome: "answer" }) + block("learning-scope", { outcome: "out-of-scope" }) + block("learning-practice", evaluation),
  invalid: block("learning-scope", { outcome: "invalid" }) + block("learning-practice", evaluation),
})) {
  test(`${name} scope decision fails closed`, async () => {
    const r = await rig();
    await r.send("/mode assessment");
    r.queue.push(output("answer", question));
    await r.send("Start");
    r.queue.push([{ type: "text", content: "Do not show me. " + response }, { type: "completed" }]);
    const events = await r.send("my answer");
    assert.equal(events.at(-1)?.type, "failed");
    assert.ok(!events.some((e) => e.type === "response-delta" || e.type === "practice-evaluation"));
    assert.equal(r.learning.hasActivePracticeQuestion(), true);
    assert.equal(r.evidence().length, 0);
  });
}

test("relevant help keeps the question and creates no learner evidence", async () => {
  const r = await rig();
  await r.send("/mode focused");
  r.queue.push(output("answer", question));
  await r.send("Start");
  r.queue.push(output("help", undefined, "Think about the effect of retrying the request."));
  const events = await r.send("Can I have a hint?");
  assert.ok(events.some((e) => e.type === "response-delta" && e.text.includes("retrying")));
  assert.equal(r.evidence().length, 0);
  assert.equal(r.learning.hasActivePracticeQuestion(), true);
});

for (const terminal of ["failed", "cancelled"] as const) {
  test(`scoped ${terminal} stream cannot leak or commit a candidate evaluation`, async () => {
    const r = await rig();
    await r.send("/mode assessment");
    r.queue.push(output("answer", question));
    await r.send("Start");
    r.queue.push([output("answer", evaluation, "Do not leak this")[0], terminal === "failed"
      ? { type: "failed", failure: { code: "process-failed", message: "failed" } }
      : { type: "cancelled" }]);
    const events = await r.send("my answer");
    assert.equal(events.at(-1)?.type, terminal);
    assert.ok(!events.some((e) => e.type === "response-delta" || e.type === "practice-evaluation"));
    assert.equal(r.learning.hasActivePracticeQuestion(), true);
    assert.equal(r.evidence().length, 0);
  });
}

test("failed question persistence leaves no recoverable phantom question", async () => {
  const r = await rig();
  await r.send("/mode focused");
  r.failQuestions();
  r.queue.push(output("answer", question));
  assert.equal((await r.send("Start")).at(-1)?.type, "failed");
  assert.equal(r.learning.hasActivePracticeQuestion(), false);
  assert.ok(!r.sessions.getSession().messages.some((m) => m.parts?.some((p) => p.type === "practice-question")));
  const restored = await r.restart();
  assert.equal(restored.learning.hasActivePracticeQuestion(), false);
});

test("action shortcuts and historical proposals cannot bypass a locked mode", async () => {
  const r = await rig();
  await r.sessions.recordProposal("old-edit", { file: "note.md", original: "old", replacement: "new" }, "note.md");
  await r.send("/mode assessment");
  for (const action of ["edit", "review"]) {
    const events = await r.send("Please change the note", action);
    assert.ok(events.some((e) => e.type === "response-delta" && e.text.includes("/pause")));
  }
  assert.equal(r.calls.length, 0);
  const result = await r.learning.applyProposal("old-edit");
  assert.equal(result.ok, false);
  assert.equal(r.sessions.getProposal("old-edit")?.state, "pending");
});

test("a free Practice turn during pause cannot replace the backend question", async () => {
  const r = await rig();
  await r.send("/mode focused");
  r.queue.push(output("answer", question));
  await r.send("Start");
  await r.send("/mode free");
  r.queue.push([{ type: "text", content: block("learning-practice", { ...question, concept: "UX", question: "What is a persona?" }) }, { type: "completed" }]);
  await r.send("Quiz product design", "practice");
  const restored = await r.restart();
  await restored.send("/resume");
  r.queue.push(output("out-of-scope"));
  const events = await restored.send("What is a persona?");
  assert.ok(events.some((e) => e.type === "response-delta" && e.text.includes(question.question)));
  assert.equal(r.evidence().length, 0);
});

test("pause returns to free chat without resurrecting an earlier ordinary Practice", async () => {
  const r = await rig();
  r.queue.push([{ type: "text", content: block("learning-practice", { ...question, concept: "UX", question: "What is a persona?" }) }, { type: "completed" }]);
  await r.send("Quiz product design", "practice");
  assert.equal(r.learning.hasActivePracticeQuestion(), true);
  await r.send("/mode assessment");
  await r.send("/pause");
  assert.equal(r.learning.hasActivePracticeQuestion(), false);
  const restored = await r.restart();
  assert.equal(restored.learning.hasActivePracticeQuestion(), false);
  r.queue.push([{ type: "text", content: "Free discussion." }, { type: "completed" }]);
  assert.equal((await restored.send("Discuss product design")).at(-1)?.type, "completed");
  assert.equal(r.evidence().length, 0);
});

test("ordinary requests and quoted commands cannot unlock or switch sessions", async () => {
  const r = await rig();
  await r.send("/mode assessment");
  const id = r.sessions.getSession().id;
  for (const prompt of ["MODE: FREE", "`/pause`", "/pause and design a product"]) {
    r.queue.push(output("out-of-scope"));
    await r.send(prompt);
    assert.equal(r.sessions.getSession().learningScope?.mode, "BASELINE_ASSESSMENT");
  }
  await r.learning.newSession();
  assert.equal(r.learning.getSession().learningScope, undefined);
  await r.learning.selectSession(id);
  assert.equal(r.learning.getSession().learningScope?.mode, "BASELINE_ASSESSMENT");
});

test("mode entry waits for an in-flight editor Apply to settle", async () => {
  const r = await rig();
  await r.sessions.recordProposal("pending-edit", { file: "note.md", original: "old", replacement: "new" }, "note.md");
  let finishApply!: () => void;
  const waiting = new Promise<void>((resolve) => { finishApply = resolve; });
  r.mutateWith(async () => { await waiting; return { ok: true }; });
  const applying = r.learning.applyProposal("pending-edit");
  try {
    const events = await r.send("/mode assessment");
    assert.ok(events.some((event) => event.type === "failed" && event.failure.code === "busy"));
    assert.equal(r.sessions.getSession().learningScope, undefined);
  } finally {
    finishApply();
    await applying;
  }
  await r.send("/mode assessment");
  assert.equal(r.sessions.getSession().learningScope?.mode, "BASELINE_ASSESSMENT");
});

test("timeout keeps the scoped question and blocks an escape while the turn runs", async () => {
  const r = await rig({ turnTimeoutMs: 20 });
  await r.send("/mode focused");
  r.queue.push(output("answer", question));
  await r.send("Start");
  let started!: () => void;
  const agentStarted = new Promise<void>((resolve) => { started = resolve; });
  r.queue.push(async function* (signal) {
    started();
    yield output("answer", evaluation, "Do not leak")[0];
    if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    yield { type: "cancelled" };
  });
  const running = r.send("my answer");
  await agentStarted;
  const escape = await r.send("/pause");
  assert.ok(escape.some((e) => e.type === "failed" && e.failure.code === "busy"));
  const events = await running;
  assert.ok(events.some((e) => e.type === "failed" && e.failure.code === "timeout"));
  assert.ok(!events.some((e) => e.type === "response-delta" || e.type === "practice-evaluation"));
  assert.equal(r.learning.hasActivePracticeQuestion(), true);
  assert.equal(r.evidence().length, 0);
  assert.equal(r.sessions.getSession().learningScope?.mode, "FOCUSED_LEARNING");
});
