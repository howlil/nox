import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const expected = [
  "01-foundation", "02-composer", "03-history", "04-practice",
  "05-settings-usage", "06-practice-feedback", "07-visuals",
  "08-thinking", "09-settings-shell", "10-history-interaction",
  "11-onboarding", "12-activity", "13-settings-navigation", "14-learning",
];

test("Obsidian ships one stylesheet with ordered, independently checked sources", () => {
  const entry = readFileSync("styles.css", "utf8");
  const actual = [...entry.matchAll(/@import "\.\/styles\/([\w-]+\.css)";/g)]
    .map(match => match[1].replace(/\.css$/, ""));
  assert.deepEqual(actual, expected,
    "source imports are ordered to preserve the original CSS cascade");
  assert.match(entry, /@import "tailwindcss\/theme\.css";/);
  assert.match(entry, /@import "tailwindcss\/utilities\.css";/);
  assert.match(entry, /@source "\.\/src";/);
  assert.doesNotMatch(entry, /\.nox-root\s*\{/,
    "feature rules must live in one of the independently owned sources");
  for (const name of expected) {
    const content = readFileSync("styles/" + name + ".css", "utf8");
    assert.ok(content.length > 100, name + " source unexpectedly empty");
  }
});

test("CSS tokens remain scoped to NOX, not global Obsidian host", () => {
  const foundation = readFileSync("styles/01-foundation.css", "utf8");
  assert.match(foundation, /--nox-accent:\s*#8653D5/i);
  assert.match(foundation, /\.nox-root,\s*\.nox-settings,\s*\.nox-theme-portal/);
  assert.doesNotMatch(foundation, /(?:^|\n)\s*:root\s*\{/);
});
