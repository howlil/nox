import assert from "node:assert/strict";
import test from "node:test";
import { SessionStore } from "../../src/session/SessionStore";
import { SessionController } from "../../src/session/SessionController";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";

test("archive is durable, filters active history, and restore recovers the transcript", async () => {
  let timestamp = 10, counter = 0;
  const store = new SessionStore({ now: () => ++timestamp, uuid: () => String(++counter) });
  const first = store.createSession();
  const second = store.createSession();
  first.messages.push({ role: "user", content: "Keep my work" });
  first.messages.push({ role: "assistant", content: "Draft edit", proposalId: "p-1",
    proposal: { file: "notes.md", original: "before", replacement: "after" },
    proposalState: "pending" });
  store.updateSession(first);

  assert.equal(store.archiveSessions([first.id, first.id], true), 1);
  assert.deepEqual(store.listSessions().map(s => s.id), [second.id]);
  assert.equal(store.listSessions(true).length, 2);
  const revived = new SessionStore();
  await revived.load(store.serialize());
  assert.equal(revived.getSession(first.id)?.messages[0].content, "Keep my work");
  assert.ok(revived.getSession(first.id)?.archivedAt);
  assert.equal(revived.getSession(first.id)?.messages[1].proposalState, "stale");
  assert.equal(revived.archiveSessions([first.id], false), 1);
  assert.equal(revived.getSession(first.id)?.archivedAt, undefined);
  assert.equal(revived.listSessions().length, 2);
});

test("removing all active sessions creates a fresh usable current session", () => {
  let counter = 0;
  const store = new SessionStore({ now: () => 100, uuid: () => String(++counter) });
  const first = store.createSession();
  const second = store.createSession();
  assert.equal(store.deleteSessions([first.id, second.id, second.id]), 2);
  assert.equal(store.listSessions().length, 1);
  assert.equal(store.getCurrentSession()?.id, "3");
  assert.equal(store.getSession(first.id), null);
  assert.equal(store.getSession(second.id), null);
});

test("archiving the current session switches to an active fallback", () => {
  let counter = 0;
  const store = new SessionStore({ now: () => 100, uuid: () => String(++counter) });
  const older = store.createSession();
  const selected = store.createSession();
  store.archiveSessions([selected.id], true);
  assert.equal(store.getCurrentSession()?.id, older.id);
  store.archiveSessions([older.id], true);
  assert.equal(store.getCurrentSession()?.id, "3");
  assert.equal(store.listSessions(true).length, 3);
  assert.equal(store.listSessions().length, 1);
});

test("failed durable bulk mutation leaves current and history unchanged", async () => {
  let durable: Record<string, unknown> | null = null;
  let fail = false;
  let counter = 0;
  const plugin = {
    loadData: async () => durable,
    saveData: async (value: Record<string, unknown>) => {
      if (fail) throw new Error("disk full");
      durable = structuredClone(value);
    },
  };
  const controller = new SessionController(
    new PluginDataRepository(plugin as never),
    new SessionStore({ now: () => 42, uuid: () => String(++counter) }),
  );
  await controller.init();
  const first = controller.getSession().id;
  await controller.newSession();
  const second = controller.getSession().id;
  const before = structuredClone(durable);
  fail = true;
  await assert.rejects(controller.mutateHistory([first, second], "delete"), /Unable to persist/);
  assert.deepEqual(durable, before);
  assert.equal(controller.getSession().id, second);
  assert.equal(controller.listSessions().length, 2);
  fail = false;
  const result = await controller.mutateHistory([first, second], "delete");
  assert.equal(result.affected, 2);
  assert.equal(result.activeSessionChanged, true);
  assert.equal(controller.listSessions().length, 1);
  assert.notEqual(controller.getSession().id, second);
});
