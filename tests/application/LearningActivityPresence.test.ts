import assert from "node:assert/strict";
import test from "node:test";
import { LearningActivityPresence } from "../../src/application/LearningActivityPresence";

test("idle transitions are emitted only when the threshold is actually crossed", async () => {
  let now = 0;
  const values: boolean[] = [];
  const presence = new LearningActivityPresence(async idle => { values.push(idle); }, () => now);
  now = 179_999;
  await presence.checkIdle();
  assert.deepEqual(values, []);
  now = 180_000;
  await presence.checkIdle();
  await presence.checkIdle();
  assert.deepEqual(values, [true]);
  now = 180_001;
  await presence.observeInteraction();
  assert.deepEqual(values, [true, false]);
});

test("failed idle persistence is retried without losing the transition", async () => {
  let now = 0;
  const values: boolean[] = [];
  let fail = true;
  const presence = new LearningActivityPresence(async idle => {
    if (fail) { fail = false; throw new Error("temporary CAS failure"); }
    values.push(idle);
  }, () => now);
  now = 180_001;
  await assert.rejects(presence.checkIdle(), /temporary CAS failure/);
  await presence.checkIdle();
  assert.deepEqual(values, [true]);
  await presence.observeInteraction();
  assert.deepEqual(values, [true, false]);
});

test("an interaction during a pending idle write is applied after it settles", async () => {
  let now = 0;
  const values: boolean[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const presence = new LearningActivityPresence(async idle => {
    if (idle) await blocked;
    values.push(idle);
  }, () => now);
  now = 180_001;
  const idle = presence.checkIdle();
  const interaction = presence.observeInteraction();
  release();
  await Promise.all([idle, interaction]);
  assert.deepEqual(values, [true, false]);
});
