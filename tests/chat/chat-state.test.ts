import assert from "node:assert/strict";
import test from "node:test";
import {
  hasInspectableContext,
  isLocallyExecutableCommand,
  shouldResetAction,
} from "../../src/chat/chat-state";

test("context is inspectable when any context category exists", () => {
  assert.equal(
    hasInspectableContext({
      hasSelection: false,
      hasActiveNote: false,
      explicitCount: 0,
      systemCount: 1,
    }),
    true,
  );

  assert.equal(
    hasInspectableContext({
      hasSelection: false,
      hasActiveNote: false,
      explicitCount: 0,
      systemCount: 0,
    }),
    false,
  );
});

test("one-shot actions reset after every terminal outcome", () => {
  for (const outcome of ["completed", "stopped", "failed"] as const) {
    assert.equal(shouldResetAction("explain", outcome), true);
    assert.equal(shouldResetAction("review", outcome), true);
    assert.equal(shouldResetAction("edit", outcome), true);
  }
});

test("practice remains selected while another question is available", () => {
  assert.equal(shouldResetAction("practice", "completed", true), false);
  assert.equal(shouldResetAction("practice", "completed", false), true);
  assert.equal(shouldResetAction("practice", "failed"), false);
});

test("offline learning controls permit local commands but not inference", () => {
  for (const input of ["/hint", "/progress", "/review-due", "/programs",
    "/session-time", "/start-session", "/pause-session", "/resume-session",
    "/end-session", "/extend-session 15",
    "/use-program 12345678-1234-1234-1234-123456789abc",
    "/mode focused", "/pause"]) {
    assert.equal(isLocallyExecutableCommand(input), true, input);
  }
  for (const input of ["Ask about Java", "/plan Learn Java", "/next",
    "/free-practice", "/extend-session invalid", "/research concurrency"]) {
    assert.equal(isLocallyExecutableCommand(input), false, input);
  }
});
