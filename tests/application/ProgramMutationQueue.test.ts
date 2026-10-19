import assert from "node:assert/strict";
import test from "node:test";
import { ProgramMutationQueue } from "../../src/application/ProgramMutationQueue";

test("one mutation lane preserves FIFO ordering and exposes current writer", async () => {
  const queue = new ProgramMutationQueue();
  const events: string[] = [];
  let release!: () => void;
  const firstHeld = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run(async () => {
    assert.equal(queue.isWriting, true);
    events.push("first-start");
    await firstHeld;
    events.push("first-end");
    return 1;
  });
  const second = queue.run(async () => {
    events.push("second");
    return 2;
  });
  await Promise.resolve();
  assert.deepEqual(events, ["first-start"]);
  release();
  assert.equal(await first, 1);
  assert.equal(await second, 2);
  await queue.idle();
  assert.deepEqual(events, ["first-start", "first-end", "second"]);
  assert.equal(queue.isWriting, false);
});

test("a failed write does not poison queued operations", async () => {
  const queue = new ProgramMutationQueue();
  const first = queue.run(async (): Promise<void> => { throw new Error("CAS conflict"); });
  const second = queue.run(async () => 42);
  await assert.rejects(first, /CAS conflict/);
  assert.equal(await second, 42);
  await queue.idle();
  assert.equal(queue.isWriting, false);
});
