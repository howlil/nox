import assert from "node:assert/strict";
import test from "node:test";
import { LearningMutationGate } from "../../src/application/LearningMutationGate";

test("learning mutation gate serializes cross-store work through commit and releases on success", async () => {
  const gate = new LearningMutationGate();
  const events: string[] = [];
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const commit = gate.run(async () => {
    events.push("authority-check");
    started();
    await held;
    events.push("transcript-committed");
    events.push("progress-projected");
    return "committed";
  });
  await entered;
  const changeFocus = gate.run(async () => {
    events.push("focus-updated");
  });
  await Promise.resolve();
  assert.deepEqual(events, ["authority-check"]);
  release();
  assert.equal(await commit, "committed");
  await changeFocus;
  assert.deepEqual(events, [
    "authority-check", "transcript-committed", "progress-projected", "focus-updated",
  ]);
});

test("failed canonical write releases the gate without publishing the attempted follow-up", async () => {
  const gate = new LearningMutationGate();
  const events: string[] = [];
  const broken = gate.run(async () => {
    events.push("transcript-rejected");
    throw new Error("persistence failed");
  });
  const retry = gate.run(async () => {
    events.push("retry-accepted");
    return "recovered";
  });
  await assert.rejects(broken, /persistence failed/);
  assert.equal(await retry, "recovered");
  assert.deepEqual(events, ["transcript-rejected", "retry-accepted"]);
});
