import assert from "node:assert/strict";
import test from "node:test";
import { SessionStore } from "../../src/session/SessionStore";

test("creates deterministic sessions and orders newest first", () => {
  let now = 100;
  let id = 0;
  const store = new SessionStore({
    now: () => now,
    uuid: () => "session-" + ++id,
  });

  const first = store.createSession("model-a");
  now = 200;
  const second = store.createSession("model-b");

  assert.equal(first.id, "session-1");
  assert.equal(first.createdAt, 100);
  assert.equal(second.id, "session-2");
  assert.deepEqual(
    store.listSessions().map((session) => session.id),
    ["session-2", "session-1"],
  );
});

test("loads legacy storage and expires pending proposals", async () => {
  const store = new SessionStore();

  await store.load({
    "agy-sessions": {
      currentSessionId: "legacy",
      sessions: {
        legacy: {
          id: "legacy",
          messages: [
            {
              role: "assistant",
              content: "",
              proposalId: "proposal-1",
              proposal: {
                file: "note.md",
                original: "a",
                replacement: "b",
              },
              proposalState: "pending",
            },
          ],
          createdAt: 1,
          updatedAt: 2,
        },
      },
      defaultModel: "model-a",
    },
  });

  const session = store.getCurrentSession();
  assert.equal(session?.id, "legacy");
  assert.equal(
    session?.messages[0]?.proposalState,
    "stale",
  );
  assert.equal(store.getDefaultModel(), "model-a");
});

test("nox storage wins when both new and legacy keys exist", async () => {
  const store = new SessionStore();

  await store.load({
    "nox-sessions": {
      currentSessionId: "new",
      sessions: {
        new: {
          id: "new",
          messages: [],
          createdAt: 3,
          updatedAt: 4,
        },
      },
    },
    "agy-sessions": {
      currentSessionId: "legacy",
      sessions: {
        legacy: {
          id: "legacy",
          messages: [],
          createdAt: 1,
          updatedAt: 2,
        },
      },
    },
  });

  assert.equal(store.getCurrentSession()?.id, "new");
});

test("invalid sessions are skipped during decoding", async () => {
  const store = new SessionStore();

  await store.load({
    "nox-sessions": {
      currentSessionId: "bad",
      sessions: {
        bad: { id: "bad", messages: "nope" },
      },
    },
  });

  assert.equal(store.getCurrentSession(), null);
  assert.deepEqual(store.listSessions(), []);
});

test("read and serialized snapshots cannot mutate stored sessions", () => {
  const store = new SessionStore({ now: () => 42, uuid: () => "immutable" });
  store.createSession();
  store.getSession("immutable")!.messages.push({ role: "user", content: "injected" });
  store.listSessions()[0]!.model = "injected";
  const saved = store.serialize() as { "nox-sessions": { sessions: Record<string, { messages: unknown[] }> } };
  saved["nox-sessions"].sessions.immutable.messages.push("injected");
  assert.equal(store.getSession("immutable")!.messages.length, 0);
  assert.equal(store.getSession("immutable")!.model, undefined);
});

test("typed practice question survives session serialization", async () => {
  const store = new SessionStore({ now: () => 1, uuid: () => "practice" });
  const session = store.createSession();
  session.messages.push({ role: "assistant", content: "", parts: [{
    type: "practice-question", questionId: "q-1",
    question: { kind: "question", concept: "SQL", question: "What is ACID?" },
    origin: { file: "note.md", selectedText: "ACID" },
  }] });
  store.updateSession(session);
  const restored = new SessionStore();
  await restored.load(store.serialize());
  const part = restored.getCurrentSession()?.messages[0]?.parts?.[0];
  assert.equal(part?.type, "practice-question");
  if (part?.type === "practice-question") {
    assert.equal(part.questionId, "q-1");
    assert.equal(part.origin?.file, "note.md");
  }
});

test("decoder strips invalid proposal payloads without losing other history", async () => {
  const store = new SessionStore();
  await store.load({
    "nox-sessions": {
      currentSessionId: "safe",
      sessions: {
        safe: {
          id: "safe", createdAt: 1, updatedAt: 2,
          messages: [
            { role: "assistant", content: "valid text",
              proposalId: "unsafe", proposalState: "pending",
              proposal: { file: 123, original: "A", replacement: "B" },
              parts: [
                { type: "unknown", arbitrary: "discard" },
                { type: "practice-question", questionId: "q1",
                  question: { kind: "question", concept: "SQL", question: "Explain ACID." },
                  origin: { file: "valid.md" } },
              ],
              ignored: { unexpected: "data" } },
          ],
        },
      },
    },
  });
  const restored = store.getCurrentSession()?.messages[0];
  assert.equal(restored?.content, "valid text");
  assert.equal(restored?.proposal, undefined);
  assert.equal(restored?.proposalId, undefined);
  assert.equal(restored?.proposalState, undefined);
  assert.equal(restored?.parts?.length, 1);
  assert.equal(restored?.parts?.[0]?.type, "practice-question");
  assert.equal("ignored" in (restored ?? {}), false);
});

test("valid legacy proposal is preserved but never actionable after restart", async () => {
  const store = new SessionStore();
  await store.load({
    "agy-sessions": {
      currentSessionId: "old",
      sessions: {
        old: { id: "old", createdAt: 1, updatedAt: 1,
          messages: [{
            role: "assistant", content: "", proposalId: "p1",
            proposalState: "pending", proposalMutableFile: "old.md",
            proposal: { file: "old.md", original: "a", replacement: "b" },
          }] },
      },
    },
  });
  const restored = store.getCurrentSession()?.messages[0];
  assert.equal(restored?.proposal?.file, "old.md");
  assert.equal(restored?.proposalState, "stale");
});

test("assistant message with thought and elapsedMs survives session serialization", async () => {
  const store = new SessionStore({ now: () => 1, uuid: () => "thought-session" });
  const session = store.createSession();
  session.messages.push({
    role: "assistant",
    content: "Final answer",
    thought: "Here is my reasoning",
    elapsedMs: 2450,
  });
  store.updateSession(session);
  const restored = new SessionStore();
  await restored.load(store.serialize());
  const msg = restored.getCurrentSession()?.messages[0];
  assert.equal(msg?.content, "Final answer");
  assert.equal(msg?.thought, "Here is my reasoning");
  assert.equal(msg?.elapsedMs, 2450);
});


test("decodes valid latency metrics and discards malformed optional timings", async () => {
  const metrics = {
    estimatedInputTokens: 100, estimatedContextTokens: 45, estimatedHistoryTokens: 20,
    shortenedSources: 0, retrievedChunks: 0, compacted: false,
    elapsedMs: 1400, firstTokenMs: 100, contextMs: 12,
    preparationMs: 40, firstVisibleMs: 210,
    providerFirstTextMs: 170, providerDurationMs: 1200,
  };
  const store = new SessionStore();
  await store.load({
    "nox-sessions": {
      currentSessionId: "measured",
      sessions: {
        measured: {
          id: "measured", createdAt: 1, updatedAt: 2,
          messages: [{ role: "assistant", content: "Hello", metrics }],
        },
      },
    },
  });
  const restored = store.getCurrentSession()?.messages[0]?.metrics;
  assert.equal(restored?.contextMs, 12);
  assert.equal(restored?.preparationMs, 40);
  assert.equal(restored?.firstVisibleMs, 210);
  assert.equal(restored?.providerFirstTextMs, 170);
  assert.equal(restored?.providerDurationMs, 1200);

  metrics.firstVisibleMs = -1;
  metrics.providerFirstTextMs = -1;
  await store.load({
    "nox-sessions": {
      currentSessionId: "measured",
      sessions: {
        measured: {
          id: "measured", createdAt: 1, updatedAt: 2,
          messages: [{ role: "assistant", content: "Hello", metrics }],
        },
      },
    },
  });
  assert.equal(store.getCurrentSession()?.messages[0]?.metrics?.firstVisibleMs, undefined);
  assert.equal(store.getCurrentSession()?.messages[0]?.metrics?.providerFirstTextMs, undefined);
  assert.equal(store.getCurrentSession()?.messages[0]?.metrics?.elapsedMs, 1400);
});

test("staged session state is isolated before and after durable publication", () => {
  const store = new SessionStore({ now: () => 11, uuid: () => "staged" });
  store.createSession();
  const stage = store.stageTransaction(draft => {
    const session = draft.getSession("staged")!;
    session.messages.push({ role: "user", content: "hello" });
    draft.updateSession(session);
    return draft;
  });
  assert.equal(store.getCurrentSession()!.messages.length, 0);
  stage.publish();
  assert.equal(store.getCurrentSession()!.messages.length, 1);
  // The caller is allowed to retain the staged transaction result.
  stage.result.getSession("staged")!.messages.push({ role: "user", content: "not committed" });
  stage.result.updateSession({ ...stage.result.getSession("staged")!, model: "should not leak" });
  assert.equal(store.getCurrentSession()!.model, undefined);
});

test("v1 backend and v2 program modes roundtrip without reinterpreting transcripts", async () => {
  const store = new SessionStore({ now: () => 1, uuid: () => "v2" });
  const v2 = store.createSession();
  v2.learningScope = { version: 2, kind: "program", programId: "japanese-n5",
    mode: "FREE", resumeMode: "ASSESSMENT" };
  v2.messages.push({ role: "assistant", content: "", parts: [{
    type: "practice-question", scope: "program", questionId: "j1",
    question: { kind: "question", concept: "Hiragana",
      question: "Read あ", programId: "japanese-n5", objectiveId: "kana" },
  }] });
  store.updateSession(v2);
  const saved = store.serialize();
  const restored = new SessionStore();
  await restored.load(saved);
  assert.deepEqual(restored.getCurrentSession()?.learningScope, v2.learningScope);
  assert.equal(restored.getCurrentSession()?.messages[0]?.parts?.[0]?.type, "practice-question");
  const legacy = store.createSession();
  legacy.learningScope = { mode: "FREE", resumeMode: "FOCUSED_LEARNING" };
  legacy.messages.push({ role: "assistant", content: "", parts: [{
    type: "practice-question", scope: "backend", questionId: "b1",
    question: { kind: "question", concept: "HTTP", question: "Idempotency?" },
  }] });
  store.updateSession(legacy);
  const reloaded = new SessionStore();
  await reloaded.load(store.serialize());
  assert.deepEqual(reloaded.getCurrentSession()?.learningScope, legacy.learningScope);
  assert.equal(reloaded.getCurrentSession()?.messages[0]?.parts?.[0]?.type, "practice-question");
});
