import assert from "node:assert/strict";
import test from "node:test";
import { LatestAsyncResult } from "../../src/chat/latest-async-result";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("latest runtime health wins when older provider succeeds after newer failure", async () => {
  const gate = new LatestAsyncResult();
  const oldProvider = deferred<string>(), currentProvider = deferred<string>();
  const oldCheck = gate.run(() => oldProvider.promise);
  gate.invalidate(); // refreshRuntime starts before awaiting model refresh
  const newCheck = gate.run(() => currentProvider.promise);
  currentProvider.reject(new Error("Provider B unavailable"));
  assert.equal((await newCheck).status, "failed");
  oldProvider.resolve("Provider A ready");
  assert.deepEqual(await oldCheck, { status: "stale" });
});

test("latest success cannot be overwritten by a delayed old provider failure", async () => {
  const gate = new LatestAsyncResult();
  const oldProvider = deferred<string>(), currentProvider = deferred<string>();
  const oldCheck = gate.run(() => oldProvider.promise);
  const newCheck = gate.run(() => currentProvider.promise);
  currentProvider.resolve("Provider B ready");
  assert.deepEqual(await newCheck, { status: "current", value: "Provider B ready" });
  oldProvider.reject(new Error("Provider A disconnected"));
  assert.deepEqual(await oldCheck, { status: "stale" });
});

test("view close/open invalidates both successful and failed in-flight checks", async () => {
  const gate = new LatestAsyncResult();
  const success = deferred<string>(), failure = deferred<string>();
  const pendingSuccess = gate.run(() => success.promise);
  gate.invalidate(); // onClose, before awaiting draft flush
  success.resolve("ready");
  assert.deepEqual(await pendingSuccess, { status: "stale" });
  const pendingFailure = gate.run(() => failure.promise);
  gate.invalidate(); // a new onOpen invalidates the previous view
  failure.reject(new Error("Disconnected while closed"));
  assert.deepEqual(await pendingFailure, { status: "stale" });
});

test("current success and current error remain observable", async () => {
  const gate = new LatestAsyncResult();
  assert.deepEqual(await gate.run(async () => "ready"), { status: "current", value: "ready" });
  const error = new Error("offline");
  assert.deepEqual(await gate.run(async () => { throw error; }), { status: "failed", error });
});
