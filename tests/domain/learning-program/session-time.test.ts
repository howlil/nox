import assert from "node:assert/strict";
import test from "node:test";
import { checkpointTiming, focusSessionObjective, newSessionTiming, recoverTiming, sessionRemainingMs, setTimingPause } from "../../../packages/core/src/domain/learning-program/session-time";

const MIN = 60_000;
function advance(timing: ReturnType<typeof newSessionTiming>, from: number, to: number) {
  let t = timing;
  for (let at = from + 30_000; at <= to; at += 30_000) t = checkpointTiming(t, at);
  return t;
}
test("AI wait does not consume the active learning budget", () => {
  let t = newSessionTiming(0);
  t = advance(t, 0, 20 * MIN);
  t = setTimingPause(t, "ai-running", true, 20 * MIN);
  t = advance(t, 20 * MIN, 30 * MIN);
  t = setTimingPause(t, "ai-running", false, 30 * MIN);
  assert.equal(t.activeMs, 20 * MIN);
  assert.equal(t.aiWaitingMs, 10 * MIN);
  assert.equal(sessionRemainingMs({ startedAt: 0, timeBudgetMinutes: 45, timing: t }, 30 * MIN), 25 * MIN);
});

test("nested pause reasons do not accidentally resume study", () => {
  let t = newSessionTiming(0);
  t = setTimingPause(t, "ai-running", true, 1000);
  t = setTimingPause(t, "manual", true, 2000);
  t = setTimingPause(t, "ai-running", false, 3000);
  t = checkpointTiming(t, 4000);
  assert.equal(t.activeMs, 1000);
  assert.deepEqual(t.pauseReasons, ["manual"]);
  assert.equal(t.aiWaitingMs, 2000);
});

test("checkpointing and duplicate pause transitions are idempotent", () => {
  let t = newSessionTiming(0);
  t = setTimingPause(t, "ai-running", true, 500);
  t = setTimingPause(t, "ai-running", true, 500);
  t = setTimingPause(t, "ai-running", false, 1500);
  t = setTimingPause(t, "ai-running", false, 1500);
  assert.equal(t.aiWaitingMs, 1000);
  assert.equal(t.activeMs, 500);
});

test("recover rejects unobserved downtime and never consumes legacy wall time", () => {
  const recovered = recoverTiming({ startedAt: 0, timeBudgetMinutes: 45 }, 100 * MIN);
  assert.deepEqual(recovered.pauseReasons, ["recovery"]);
  assert.equal(sessionRemainingMs({ startedAt: 0, timeBudgetMinutes: 45, timing: recovered }, 500 * MIN), 45 * MIN);
});

test("objective focus accumulates only confirmed active study", () => {
  let t = focusSessionObjective(newSessionTiming(0), "sql", 1000);
  t = checkpointTiming(t, 31_000);
  t = setTimingPause(t, "ai-running", true, 31_000);
  t = checkpointTiming(t, 61_000);
  assert.equal(t.objectiveActiveMs?.sql, 30_000);
  assert.equal(t.activeMs, 31_000);
  assert.equal(t.aiWaitingMs, 30_000);
});

test("clock rollback cannot create negative or backdated checkpoints", () => {
  const t = checkpointTiming(newSessionTiming(1000), 100);
  assert.equal(t.activeMs, 0);
  assert.equal(t.checkpointAt, 1000);
});

test("long unobserved intervals are not charged as learning", () => {
  const t = checkpointTiming(newSessionTiming(0), 10 * MIN);
  assert.equal(t.activeMs, 0);
  assert.equal(t.checkpointAt, 10 * MIN);
});
