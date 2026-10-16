import assert from "node:assert/strict";
import test from "node:test";
import { authorizeFocusIntent } from "../../../src/domain/learning-program/focus-authorization";
import type { FocusSession } from "../../../src/domain/learning-program/types";

const focus: FocusSession = {
  id: "focus-1", programId: "program-a", objectiveId: "objective-a",
  curriculumRevision: 1, chatSessionId: "chat-owner",
  status: "active", startedAt: 100,
};

test("active focus locks program mutation and cross-chat answers", () => {
  assert.deepEqual(authorizeFocusIntent(focus, { kind: "switch-program" }),
    { allowed: false, reason: "focus-active" });
  assert.deepEqual(authorizeFocusIntent(focus, { kind: "create-program" }),
    { allowed: false, reason: "focus-active" });
  assert.deepEqual(authorizeFocusIntent(focus, { kind: "submit-answer",
    chatSessionId: "other", programId: "program-a", objectiveId: "objective-a" }),
    { allowed: false, reason: "wrong-chat" });
  assert.deepEqual(authorizeFocusIntent(focus, { kind: "submit-answer",
    chatSessionId: "chat-owner", programId: "program-a", objectiveId: "objective-b" }),
    { allowed: false, reason: "wrong-objective" });
  assert.deepEqual(authorizeFocusIntent(focus, { kind: "submit-answer",
    chatSessionId: "chat-owner", programId: "program-a", objectiveId: "objective-a" }),
    { allowed: true });
  assert.deepEqual(authorizeFocusIntent(focus, { kind: "pause" }), { allowed: true });
});

test("paused focus preserves identity but permits switching programs", () => {
  const paused: FocusSession = { ...focus, status: "paused", pausedAt: 200 };
  assert.deepEqual(authorizeFocusIntent(paused, { kind: "switch-program" }), { allowed: true });
  assert.deepEqual(authorizeFocusIntent(paused, { kind: "create-program" }), { allowed: true });
  assert.deepEqual(authorizeFocusIntent(paused, { kind: "resume" }), { allowed: true });
  assert.deepEqual(authorizeFocusIntent(paused, { kind: "submit-answer",
    chatSessionId: "chat-owner", programId: "program-a", objectiveId: "objective-a" }),
    { allowed: false, reason: "focus-paused" });
});
