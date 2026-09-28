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
