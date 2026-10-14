import assert from "node:assert/strict";
import test from "node:test";
import { buildActionMenu, getPrimaryAction, type ActionMenuContext } from "../../src/chat/action-menu";

const empty: ActionMenuContext = {
  hasActiveSession: false,
  hasPracticeQuestion: false,
  savedProgramCount: 0,
  legacyMode: "free",
};
const saved: ActionMenuContext = {
  ...empty, activeProgramId: "course-1", savedProgramCount: 2,
};

test("default actions expose only one primary CTA and four note tools", () => {
  assert.deepEqual(buildActionMenu(empty).map(item => item.key),
    ["plan", "explain", "practice", "review", "edit"]);
  assert.deepEqual(buildActionMenu(saved).map(item => item.key),
    ["start-session", "explain", "practice", "review", "edit", "programs"]);
  assert.deepEqual(buildActionMenu({ ...saved, hasActiveSession: true }).map(item => item.key),
    ["next", "explain", "practice", "review", "edit", "programs"]);
});

test("same authoritative primary action drives menu and welcome card", () => {
  for (const state of [
    empty, saved, { ...saved, hasActiveSession: true },
    { ...saved, hasActiveSession: true, hasPracticeQuestion: true },
    { ...empty, legacyMode: "locked" as const },
    { ...empty, legacyMode: "paused" as const },
  ]) {
    assert.equal(buildActionMenu(state)[0].key, getPrimaryAction(state).key);
  }
});

test("one-character search is prefix-only: /s cannot expand into all session descriptions", () => {
  assert.deepEqual(buildActionMenu(saved, "s").map(item => item.key), ["start-session"]);
  assert.deepEqual(buildActionMenu(saved, "/s").map(item => item.key), ["start-session"]);
  assert.deepEqual(buildActionMenu({ ...saved, hasActiveSession: true }, "s").map(item => item.key), ["session-time"]);
  assert.equal(buildActionMenu(saved, "q").length, 0);
});

test("query prioritizes commands, titles and explicit keywords, never descriptions", () => {
  assert.deepEqual(buildActionMenu(saved, "pro").map(item => item.key),
    ["progress", "programs"]);
  assert.deepEqual(buildActionMenu(saved, "use-program"), []);
  assert.deepEqual(buildActionMenu(saved, "switch").map(item => item.key), ["programs"]);
  assert.deepEqual(buildActionMenu(saved, "legacy"), []);
  assert.deepEqual(buildActionMenu(saved, "backend"), []);
  assert.deepEqual(buildActionMenu(saved, "mode"), []);
  assert.deepEqual(buildActionMenu(saved, "not-a-command"), []);
  assert.deepEqual(buildActionMenu(saved, "timeboxed"), []);
});

test("legacy backend modes remain out of discovery even under active legacy lock", () => {
  const locked: ActionMenuContext = { ...saved, legacyMode: "locked" };
  assert.deepEqual(buildActionMenu(locked).map(item => item.key), ["pause", "practice"]);
  assert.deepEqual(buildActionMenu(locked, "explain"), []);
  assert.deepEqual(buildActionMenu(locked, "assessment"), []);
  assert.equal(buildActionMenu(locked, "pause")[0].key, "pause");
  const paused: ActionMenuContext = { ...empty, legacyMode: "paused" };
  assert.equal(buildActionMenu(paused)[0].key, "resume");
  assert.deepEqual(buildActionMenu(paused, "resume").map(item => item.key), ["resume"]);
  assert.deepEqual(buildActionMenu(empty, "resume"), []);
});

test("advanced actions are contextual and no command is duplicated", () => {
  assert.deepEqual(buildActionMenu(empty, "hint"), []);
  assert.deepEqual(buildActionMenu(empty, "end-session"), []);
  assert.deepEqual(buildActionMenu(saved, "extend-session"), []);
  assert.deepEqual(buildActionMenu({ ...saved, hasActiveSession: true }, "extend-session")
    .map(item => item.key), ["extend-session"]);
  assert.deepEqual(buildActionMenu({ ...saved, hasPracticeQuestion: true }, "hint")
    .map(item => item.key), ["hint"]);
  for (const state of [empty, saved, { ...saved, hasActiveSession: true }]) {
    const commands = buildActionMenu(state, "pro").map(item => item.command);
    assert.equal(new Set(commands).size, commands.length);
  }
});

test("search results are bounded and deterministic", () => {
  const state: ActionMenuContext = { ...saved, hasActiveSession: true };
  assert.ok(buildActionMenu(state, "learn").length <= 8);
  assert.deepEqual(buildActionMenu(state, "learn"), buildActionMenu(state, "learn"));
});

test("research command is discoverable but does not bloat the default menu", () => {
  assert.deepEqual(buildActionMenu(empty, "research").map(item => item.key), ["research"]);
  assert.deepEqual(buildActionMenu(empty).map(item => item.key),
    ["plan", "explain", "practice", "review", "edit"]);
  assert.deepEqual(buildActionMenu({ ...empty, legacyMode: "locked" }, "research"), []);
});
