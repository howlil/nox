import assert from "node:assert/strict";
import test from "node:test";
import { buildActionMenu, type ActionMenuContext } from "../../src/chat/action-menu";

const empty: ActionMenuContext = {
  hasActiveSession: false,
  hasPracticeQuestion: false,
  savedProgramCount: 0,
  legacyMode: "free",
};

const saved: ActionMenuContext = {
  ...empty,
  activeProgramId: "course-1",
  savedProgramCount: 2,
};

test("default action menu has only goal action and four note capabilities", () => {
  const items = buildActionMenu(empty);
  assert.deepEqual(items.map(i => i.key), ["plan", "explain", "practice", "review", "edit"]);
  assert.equal(items.some(i => i.key === "assessment"), false);
});

test("program start and continue are state-dependent, never both default", () => {
  const waiting = buildActionMenu(saved);
  assert.deepEqual(waiting.map(i => i.key), ["start-session", "explain", "practice", "review", "edit", "programs"]);
  const active = buildActionMenu({ ...saved, hasActiveSession: true });
  assert.deepEqual(active.map(i => i.key), ["next", "explain", "practice", "review", "edit", "programs"]);
  const question = buildActionMenu({ ...saved, hasActiveSession: true, hasPracticeQuestion: true });
  assert.equal(question[0].key, "hint");
  assert.equal(question.some(i => i.key === "next"), false);
});

test("search filters to relevant commands and reveals advanced actions", () => {
  assert.deepEqual(buildActionMenu(saved, "pro").map(i => i.key).slice(0, 3),
    ["progress", "programs", "programs-command"]);
  assert.deepEqual(buildActionMenu(saved, "use-program").map(i => i.key), ["use-program"]);
  assert.deepEqual(buildActionMenu(saved, "legacy").map(i => i.key).sort(),
    ["assessment", "focused"]);
  assert.equal(buildActionMenu(saved, "not-a-command").length, 0);
  assert.ok(buildActionMenu({ ...saved, hasActiveSession: true }, "session")
    .some(i => i.key === "end-session"));
});

test("unavailable session and hint commands do not clutter results", () => {
  assert.deepEqual(buildActionMenu(empty, "hint"), []);
  assert.deepEqual(buildActionMenu(empty, "end-session"), []);
  assert.deepEqual(buildActionMenu(saved, "extend-session"), []);
  assert.deepEqual(buildActionMenu({ ...saved, hasActiveSession: true }, "extend-session")
    .map(i => i.key), ["extend-session"]);
  assert.deepEqual(buildActionMenu({ ...saved, hasPracticeQuestion: true }, "hint")
    .map(i => i.key), ["hint"]);
});

test("paused legacy mode offers resume, while active lock offers pause", () => {
  assert.equal(buildActionMenu({ ...empty, legacyMode: "locked" }, "pause")[0].key, "pause");
  assert.deepEqual(buildActionMenu({ ...empty, legacyMode: "locked" }, "resume"), []);
  assert.equal(buildActionMenu({ ...empty, legacyMode: "paused" }, "resume")[0].key, "resume");
});

test("full search never displays more than eight options", () => {
  assert.ok(buildActionMenu({ ...saved, hasActiveSession: true }, "e").length <= 8);
});

test("legacy backend lock does not offer actions forcibly rewritten as Practice", () => {
  const locked: ActionMenuContext = { ...saved, legacyMode: "locked" };
  assert.deepEqual(buildActionMenu(locked).map(i => i.key), ["pause", "practice"]);
  assert.deepEqual(buildActionMenu(locked, "explain"), []);
  assert.equal(buildActionMenu({ ...locked, hasPracticeQuestion: true })[0].key, "hint");
  assert.equal(buildActionMenu({ ...saved, legacyMode: "paused" })[0].key, "resume");
});
