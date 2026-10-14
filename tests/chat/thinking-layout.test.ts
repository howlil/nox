import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("styles.css", "utf8");
const view = readFileSync("src/chat/ChatView.ts", "utf8");

function rule(selector: string): string {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, "missing stylesheet selector " + selector);
  const block = css.slice(start + selector.length + 2);
  const end = block.indexOf("}");
  assert.ok(end >= 0, "unterminated stylesheet selector " + selector);
  return block.slice(0, end);
}

test("thinking shares assistant reading-column width, never the compact trace width", () => {
  const thread = rule(".nox-thread");
  const shared = rule(".nox-thread > :not(.nox-bubble--user)");
  const thinking = rule(".nox-root .nox-thread > .nox-thinking");
  const inner = rule(".nox-thinking-panel-inner");
  assert.match(thread, /--nox-reading-width:\s*768px;/);
  for (const declarations of [shared, thinking]) {
    assert.match(declarations, /width:\s*min\(100%,\s*var\(--nox-reading-width\)\)/);
    assert.match(declarations, /max-width:\s*var\(--nox-reading-width\)/);
  }
  assert.match(thinking, /align-self:\s*stretch/);
  assert.match(thinking, /margin-inline:\s*auto/);
  assert.doesNotMatch(thinking, /430px|flex-start/);
  assert.match(inner, /max-width:\s*430px/);
  // Regression for the old later-and-more-specific selector that shifted
  // a 430px activity wrapper to the middle of the 768px reading column.
  assert.doesNotMatch(css, /\.nox-root \.nox-thinking\s*\{[^}]*width:\s*min\(100%,\s*430px\)/);
});

test("working and restored activity use the same direct thread child", () => {
  assert.match(view, /this\.thread\.createDiv\(\{\s*cls:\s*"nox-thinking nox-thinking--working"/);
  assert.match(view, /this\.thread\.createDiv\(\{\s*cls:\s*"nox-thinking nox-thinking--restored"/);
  assert.match(view, /this\.thread\.createDiv\(\{\s*cls:\s*"nox-bubble nox-bubble--agent/);
});
