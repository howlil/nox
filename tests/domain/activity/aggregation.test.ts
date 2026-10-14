import test from "node:test";
import assert from "node:assert/strict";
import { checkpointTiming, distributeLocalDays, newSessionTiming, setTimingPause,
  focusSessionMaterial } from "../../../src/domain/learning-program/session-time";
import { summarizeActivity } from "../../../src/domain/activity/aggregation";
import type { LearningProgram } from "../../../src/domain/learning-program/types";

test("active checkpoint attributes material and day, while AI wait never counts as focus", () => {
  const start = Date.now();
  let timing = focusSessionMaterial(newSessionTiming(start), "notes/hello.md", start);
  timing = checkpointTiming(timing, start + 25_000);
  assert.equal(timing.activeMs, 25_000);
  assert.equal(timing.materialActiveMs?.["notes/hello.md"], 25_000);
  assert.equal(Object.values(timing.dailyActiveMs ?? {}).reduce((a,b)=>a+b,0), 25_000);
  timing = setTimingPause(timing, "ai-running", true, start + 25_000);
  timing = checkpointTiming(timing, start + 45_000);
  assert.equal(timing.activeMs, 25_000);
  assert.equal(timing.aiWaitingMs, 20_000);
});
test("local midnight splits observed activity without fabricating intervals", () => {
  const at = new Date(2026, 9, 15, 23, 59, 50).getTime();
  const days = distributeLocalDays(at, at + 30_000);
  assert.equal(Object.values(days).reduce((a,b)=>a+b,0), 30_000);
  assert.equal(Object.keys(days).length, 2);
});
test("historical wall time without measured activity does not become focus time", () => {
  const p = { version:1, id:"x", goal:"Example", createdAt:0, planVersion:1,
    constraints:{minutesPerSession:45,sessionsPerWeek:3,sourcePaths:[],sourceBound:false,excludedTopics:[]},
    objectives:[], sessionHistory:[
      {startedAt:0,endedAt:1_800_000,minutesSpent:30},
      {startedAt:2_000_000,endedAt:3_000_000,minutesSpent:16,activeMinutes:7,
        dailyActiveMs:{"2026-10-15":420_000}, materialActiveMinutes:{"notes/hello.md":7}},
    ] } as LearningProgram;
  const s = summarizeActivity([p]);
  assert.equal(s.focusMinutes, 7);
  assert.equal(s.sessions, 2);
  assert.equal(s.activeDays, 1);
  assert.equal(s.materials[0].minutes, 7);
});
