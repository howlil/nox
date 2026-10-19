import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync("styles.css", "utf8");

test("M3 desktop code answer CSS retains intrinsic height and no nested vertical scroll", () => {
  assert.match(css, /\.nox-root \.nox-code-answer-host \.cm-editor \{[^}]*height: auto;[^}]*max-height: none;/);
  assert.match(css, /\.nox-root \.nox-code-answer-host \.cm-scroller \{[^}]*overflow-y: visible;/);
  assert.match(css, /\.nox-root \.nox-code-answer-host \.nox-quiz-code-editor \{[^}]*height: auto;[^}]*max-height: none;[^}]*overflow: hidden;/);
  assert.match(css, /\.nox-root \.nox-code-answer-host \.cm-content \{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.nox-root \.nox-code-answer-host \{[^}]*color-scheme: light;/);
  assert.match(css, /\.nox-root \.nox-rich-quiz \.nox-quiz-code-input/);
});

test("M3 code editor scopes syntax colors and only shows limit warning when present", () => {
  for (const kind of ["keyword", "type", "number", "string", "comment", "literal"]) {
    assert.ok(css.includes(".nox-root .nox-code-answer-host .nox-syntax-" + kind), kind);
  }
  assert.match(css, /\.nox-root \.nox-code-answer-host \.nox-code-answer-limit:empty \{ display: none; \}/);
  assert.match(css, /\.nox-root \.nox-code-answer-host:focus-within \{[^}]*border-color: #9BB1FF;/);
});
