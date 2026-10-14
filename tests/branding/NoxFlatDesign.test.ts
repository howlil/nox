import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("styles.css", "utf8");

// Protect the design contract at source level, not with a late !important patch.
test("Nox uses Howlil neutral foundations and a solid purple accent", () => {
  for (const [token, value] of [
    ["--nox-page", "#FEFEFE"],
    ["--nox-inset", "#F7F7F7"],
    ["--nox-ink", "#121212"],
    ["--nox-accent", "#8653D5"],
    ["--nox-accent-soft", "#F4EDFF"],
    ["--nox-radius-window", "14px"],
    ["--nox-space-8", "32px"],
  ]) {
    assert.ok(css.includes(`${token}: ${value};`), `missing flat token ${token}`);
  }
  assert.match(css, /\.theme-dark \.nox-settings\s*\{[^}]*--nox-page:\s*#080808;/s);
  assert.match(css, /\.theme-dark \.nox-settings\s*\{[^}]*--nox-accent:\s*#AD82EA;/s);
  assert.match(css, /\.nox-root,\s*\.nox-settings\s*\{/);
});

test("Nox presentation contains no decorative gradients or shimmer", () => {
  assert.doesNotMatch(css, /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i);
  assert.doesNotMatch(css, /\bmask-image\s*:/i);
  assert.doesNotMatch(css, /\bnox-activity-shimmer\b/);
  assert.match(css, /--nox-popover-shadow:\s*none;/);
  assert.match(css, /--nox-composer-shadow:\s*none;/);
});

test("Capability cards are neutral, with purple reserved for selection", () => {
  const start = css.indexOf(".nox-capability-card {");
  const end = css.indexOf(".nox-capability-card-top {", start);
  assert.ok(start >= 0 && end > start, "capability styles missing");
  const cards = css.slice(start, end);
  assert.match(cards, /background:\s*var\(--nox-surface\)/);
  assert.match(cards, /\.nox-capability-card\.is-selected\s*\{[^}]*background:\s*var\(--nox-accent-soft\)/s);
  assert.doesNotMatch(cards, /\.nox-capability-card--(?:blue|coral|green|purple)\s*\{/);
  assert.doesNotMatch(cards, /--nox-card-(?:glow|wash|meta-ink)/);
});

test("Learning surfaces and actions keep their canonical selectors", () => {
  for (const selector of [
    ".nox-empty-context",
    ".nox-learning-start",
    ".nox-composer-box",
    ".nox-send-btn:not(:disabled)",
    ".nox-quiz-option:has(input:checked)",
    ".nox-practice-evaluation",
    ".nox-review-card",
    ".nox-proposal",
    ".nox-learning-graph",
    ".nox-visual",
    ".nox-history-menu",
    ".nox-model-menu",
    ".nox-usage",
  ]) {
    assert.ok(css.includes(selector), `missing canonical surface ${selector}`);
  }
});
