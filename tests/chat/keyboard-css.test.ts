import assert from "node:assert/strict";
import test from "node:test";
import { noxCssSource } from "../support/css-source";

const css = noxCssSource();

/** Static contract only. Runtime computed-style proof needs Obsidian/Electron. */
function rule(selector: string): string {
  const marker = selector + " {";
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, "Missing CSS rule " + selector);
  const end = css.indexOf("}", start + marker.length);
  assert.notEqual(end, -1, "Unclosed CSS rule " + selector);
  return css.slice(start + marker.length, end);
}

function colorToken(token: string): string {
  const match = css.match(new RegExp("--" + token + ":\\s*(#[0-9a-fA-F]{6})\\s*;"));
  assert.ok(match, "Missing color token " + token);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string): number {
  const top = Math.max(luminance(first), luminance(second));
  const bottom = Math.min(luminance(first), luminance(second));
  return (top + 0.05) / (bottom + 0.05);
}

test("virtual model-picker active row has a visible outline independent of focus", () => {
  const active = rule(".nox-root .nox-model-menu-row.is-active");
  assert.match(active, /outline:\s*2px\s+solid\s+var\(--nox-accent-ink\)/);
  assert.match(active, /outline-offset:\s*-2px/);

  // The original important base background suppressed :focus-visible.
  for (const selector of [
    ".nox-root .nox-model-menu-row",
    ".nox-root .nox-model-menu-row:hover",
    ".nox-root .nox-model-menu-row.is-active",
  ]) {
    assert.doesNotMatch(rule(selector), /!important/);
  }

  assert.match(rule(".nox-root .nox-model-menu-row:focus-visible"),
    /outline:\s*2px\s+solid\s+var\(--nox-accent-ink\)/);
});

test("keyboard focus is explicitly visible on compact interactive controls", () => {
  const start = css.indexOf("/* Keyboard input is visually distinct");
  assert.ok(start > css.indexOf(".nox-root :focus-visible,"),
    "Focus overrides must come after Obsidian/NOX reset styles");
  const end = css.indexOf("/* An inset light ring", start);
  assert.ok(end > start);
  const overrides = css.slice(start, end);
  for (const className of [
    "nox-model-trigger", "nox-model-menu-retry",
    "nox-history-entry", "nox-history-action",
    "nox-history-more", "nox-history-tab",
    "nox-prompt-plus", "nox-send-btn",
  ]) {
    assert.ok(overrides.includes("." + className), "Missing focus control " + className);
  }
  assert.match(overrides, /:focus-visible\s*\{\s*outline:\s*2px\s+solid/);
  assert.match(css.slice(end), /\.nox-history-action\.is-danger:focus-visible\s*\{\s*outline-color:\s*var\(--nox-page\)/);
});

test("focus accent has at least 3:1 contrast against adjacent surfaces", () => {
  const accent = colorToken("nox-accent-ink");
  assert.ok(contrast(accent, colorToken("nox-page")) >= 3);
  assert.ok(contrast(accent, colorToken("nox-accent-soft")) >= 3);
  assert.match(rule(".nox-composer-box:focus-within"),
    /border-color:\s*var\(--nox-accent-ink\)/);
});

test("scoped history controls avoid unnecessary important styles", () => {
  for (const selector of [
    ".nox-root .nox-history-entry",
    ".nox-root .nox-history-more",
    ".nox-root .nox-history-action",
  ]) {
    assert.doesNotMatch(rule(selector), /!important/);
  }
  assert.match(css, /\.nox-composer-footer\s*\{\s*display:\s*contents;/);
});
