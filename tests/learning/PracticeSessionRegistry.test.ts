import assert from "node:assert/strict";
import test from "node:test";
import { PracticeSessionRegistry } from "../../src/learning/PracticeSessionRegistry";

test("returns one practice state machine per conversation session", () => {
  const registry = new PracticeSessionRegistry();

  const first = registry.forSession("session-1");
  const same = registry.forSession("session-1");
  const second = registry.forSession("session-2");

  assert.equal(first, same);
  assert.notEqual(first, second);
});

test("reset removes only the requested session practice state", () => {
  const registry = new PracticeSessionRegistry();
  const first = registry.forSession("session-1");
  const second = registry.forSession("session-2");

  registry.reset("session-1");

  assert.notEqual(registry.forSession("session-1"), first);
  assert.equal(registry.forSession("session-2"), second);
});

test("clear drops all transient practice state", () => {
  const registry = new PracticeSessionRegistry();
  const first = registry.forSession("session-1");
  const second = registry.forSession("session-2");

  registry.clear();

  assert.notEqual(registry.forSession("session-1"), first);
  assert.notEqual(registry.forSession("session-2"), second);
});

test("status query does not create a session and reflects question lifecycle", () => {
  const registry = new PracticeSessionRegistry();
  assert.equal(registry.hasWaitingQuestion("missing"), false);
  const practice = registry.forSession("s1");
  practice.start();
  assert.equal(registry.hasWaitingQuestion("s1"), false);
  practice.acceptQuestion({ kind: "question", concept: "transactions", question: "What is atomicity?" });
  assert.equal(registry.hasWaitingQuestion("s1"), true);
  registry.reset("s1");
  assert.equal(registry.hasWaitingQuestion("s1"), false);
});
