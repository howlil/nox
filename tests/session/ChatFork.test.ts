import assert from "node:assert/strict";
import test from "node:test";
import { SessionStore } from "../../src/session/SessionStore";
import { SessionController } from "../../src/session/SessionController";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";
import { formatReplyPrompt } from "../../src/application/reply-context";

function harness() {
  let saved: Record<string, unknown> | null = null;
  let fail = false;
  let counter = 0;
  const plugin = {
    loadData: async () => structuredClone(saved),
    saveData: async (next: Record<string, unknown>) => {
      if (fail) throw new Error("disk unavailable");
      saved = structuredClone(next);
    },
  };
  const makeController = () => new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ uuid: () => "generated-" + ++counter, now: () => 1234 }),
  );
  return { makeController, snapshot: () => structuredClone(saved),
    rejectWrites: (value: boolean) => { fail = value; } };
}

test("assistant fork copies only prefix, resets provider cursor and freezes selected versions", async () => {
  const db = harness();
  const sessions = db.makeController();
  await sessions.init();
  const parentId = sessions.getSession().id;
  await sessions.recordUserMessage("u1", parentId, "ask", "user-1");
  await sessions.recordAssistantMessage("a1", undefined, parentId);
  const assistantId = sessions.getSession().messages[1].id!;
  await sessions.recordRegeneratedResponse(1, "a1", { content: "a1 revised" }, parentId);
  await sessions.recordUserMessage("u2", parentId, "ask", "user-2");
  await sessions.recordAssistantMessage("a2", undefined, parentId);
  await sessions.setConversationId("provider-thread", parentId);
  const { session: child, draftUserPrompt } = await sessions.forkSession(parentId, assistantId);
  assert.equal(draftUserPrompt, undefined);
  assert.notEqual(child.id, parentId);
  assert.equal(child.conversationId, undefined);
  assert.deepEqual(child.messages.map(m => m.content), ["u1", "a1 revised"]);
  assert.equal(child.messages[1].responseVersions, undefined);
  assert.equal(child.fork?.parentMessageId, assistantId);
  assert.equal(child.fork?.inheritedMessageCount, 2);
  const parent = sessions.listSessions().find(s => s.id === parentId)!;
  assert.deepEqual(parent.messages.map(m => m.content), ["u1", "a1 revised", "u2", "a2"]);
  assert.equal(parent.messages[1].responseVersions?.length, 2);
  assert.equal(parent.conversationId, "provider-thread");

  const restored = db.makeController();
  await restored.init();
  assert.equal(restored.getSession().fork?.parentSessionId, parentId);
  await restored.mutateHistory([parentId], "delete");
  assert.equal(restored.getSession().id, child.id);
  assert.deepEqual(restored.getSession().messages.map(m => m.content), ["u1", "a1 revised"]);
});

test("fork from user message makes that message editable, not part of child transcript", async () => {
  const db = harness();
  const sessions = db.makeController();
  await sessions.init();
  const id = sessions.getSession().id;
  await sessions.recordUserMessage("first", id, "ask", "u1");
  await sessions.recordAssistantMessage("answer", undefined, id);
  await sessions.recordUserMessage("revise this", id, "ask", "u2");
  const result = await sessions.forkSession(id, "u2");
  assert.equal(result.draftUserPrompt, "revise this");
  assert.deepEqual(result.session.messages.map(m => m.content), ["first", "answer"]);
});

test("failed fork write leaves both active session and persisted store unchanged", async () => {
  const db = harness();
  const sessions = db.makeController();
  await sessions.init();
  const id = sessions.getSession().id;
  await sessions.recordUserMessage("original", id, "ask", "anchor");
  const activeBefore = sessions.getSession();
  const diskBefore = db.snapshot();
  db.rejectWrites(true);
  await assert.rejects(sessions.forkSession(id, "anchor"));
  assert.deepEqual(sessions.getSession(), activeBefore);
  assert.deepEqual(db.snapshot(), diskBefore);
  db.rejectWrites(false);
  assert.ok((await sessions.forkSession(id, "anchor")).session.fork);
});

test("reply quote is stored separately and checked against source assistant identity", async () => {
  const db = harness();
  const sessions = db.makeController();
  await sessions.init();
  const id = sessions.getSession().id;
  await sessions.recordUserMessage("what?", id, "ask", "u");
  await sessions.recordAssistantMessage("The answer is 42.", undefined, id);
  const ref = { sourceSessionId: id, sourceMessageId: sessions.getSession().messages[1].id!,
    sourceRole: "assistant" as const, quote: "answer is 42" };
  await sessions.recordUserMessage("why?", id, "ask", "u2", ref);
  const latest = sessions.getSession().messages.at(-1)!;
  assert.equal(latest.content, "why?");
  assert.deepEqual(latest.replyTo, ref);
  assert.match(formatReplyPrompt("why?", ref), /answer is 42/);
  await assert.rejects(sessions.recordUserMessage("bad", id, "ask", "u3",
    { ...ref, sourceMessageId: "missing" }));
  const restored = db.makeController();
  await restored.init();
  assert.deepEqual(restored.getSession().messages.at(-1)?.replyTo, ref);
});

test("legacy message IDs are deterministic without an eager storage migration", async () => {
  const store = new SessionStore();
  const raw = { "nox-sessions": { currentSessionId: "old", sessions: {
    old: { id: "old", messages: [{ role: "user", content: "hello" }],
      createdAt: 1, updatedAt: 2 },
  } } };
  await store.load(raw);
  assert.equal(store.getCurrentSession()?.messages[0].id, "legacy:0");
  await store.load(raw);
  assert.equal(store.getCurrentSession()?.messages[0].id, "legacy:0");
});

test("fork never inherits an actionable pending note edit", async () => {
  const db = harness();
  const sessions = db.makeController();
  await sessions.init();
  const parentId = sessions.getSession().id;
  const proposal = { file: "note.md", original: "before", replacement: "after" };
  await sessions.recordEditOutcome("edit:1", proposal, "", "note.md", parentId);
  const anchor = sessions.getSession().messages.at(-1)!.id!;
  const child = (await sessions.forkSession(parentId, anchor)).session;
  assert.equal(child.messages.at(-1)?.proposalState, "stale");
  assert.equal(sessions.listSessions().find(x => x.id === parentId)?.messages.at(-1)?.proposalState, "stale");
  const restored = db.makeController();
  await restored.init();
  assert.equal(restored.getSession().messages.at(-1)?.proposalState, "stale");
});
