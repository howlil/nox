import assert from "node:assert/strict";
import test from "node:test";
import { projectSessionClock, type SessionClockSnapshot } from "../../src/chat/session-clock";

const active: SessionClockSnapshot = { budgetMs: 60_000, activeMs: 0,
  remainingMs: 60_000, aiWaitingMs: 0, status: "active" };
test("W1 local session clock ticks without mutating authoritative snapshots", () => {
  const projected = projectSessionClock(active, 1000, 21_000)!;
  assert.equal(projected.activeMs, 20_000);
  assert.equal(projected.remainingMs, 40_000);
  assert.equal(active.activeMs, 0);
  assert.equal(projectSessionClock(active, 1000, 70_000)?.status, "exhausted");
});
test("W1 AI waiting never reduces focus budget; paused and recovered do not charge time", () => {
  const waiting: SessionClockSnapshot = { ...active, status: "waiting-ai" };
  assert.deepEqual(projectSessionClock(waiting, 1000, 3000), { ...waiting, aiWaitingMs: 2000 });
  for (const status of ["paused", "recovered", "exhausted"] as const) {
    const source = { ...active, status };
    assert.deepEqual(projectSessionClock(source, 1000, 3000), source);
  }
});
test("W1 ignores negative, invalid or suspended clock gaps", () => {
  for (const now of [0, Number.NaN, 200_000]) assert.deepEqual(projectSessionClock(active, 1000, now), active);
  assert.equal(projectSessionClock(null, 1000, 2000), null);
});
