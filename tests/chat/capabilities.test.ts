import assert from "node:assert/strict";
import test from "node:test";
import { NOX_CAPABILITIES } from "../../src/chat/capabilities";

test("empty-state capabilities match the slash-command surface", () => {
  assert.deepEqual(
    NOX_CAPABILITIES.map((item) => ({
      action: item.action,
      title: item.title,
      command: item.command,
    })),
    [
      {
        action: "explain",
        title: "Explain",
        command: "/explain",
      },
      {
        action: "practice",
        title: "Practice",
        command: "/practice",
      },
      {
        action: "review",
        title: "Review",
        command: "/review",
      },
      {
        action: "edit",
        title: "Improve note",
        command: "/edit",
      },
    ],
  );
});

test("capability entry surface has no separate learn mode", () => {
  assert.equal(
    NOX_CAPABILITIES.some(
      (item) =>
        item.action === ("learn" as never) ||
        item.command === "/learn",
    ),
    false,
  );
});

test("capability icons remain the shared visual source of truth", () => {
  assert.deepEqual(
    NOX_CAPABILITIES.map((item) => [item.action, item.icon]),
    [
      ["explain", "circle-help"],
      ["practice", "list-checks"],
      ["review", "search"],
      ["edit", "pencil"],
    ],
  );
});

test("welcome shortcuts retain their original visual identity and supporting copy", () => {
  assert.deepEqual(
    NOX_CAPABILITIES.map(item => ({
      action: item.action,
      tone: item.tone,
      meta: item.meta,
    })),
    [
      { action: "explain", tone: "purple", meta: "Understanding" },
      { action: "practice", tone: "blue", meta: "Recall" },
      { action: "review", tone: "coral", meta: "Gaps" },
      { action: "edit", tone: "green", meta: "Safe edit" },
    ],
  );
  assert.ok(NOX_CAPABILITIES.every(item => item.description.length > 10));
});
