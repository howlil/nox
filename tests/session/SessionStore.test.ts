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
