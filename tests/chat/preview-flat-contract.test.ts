import assert from "node:assert/strict";
import test from "node:test";
import { buildActionInstruction, buildPracticeQuestionInstruction } from "../../src/application/action-builders";
import { createNoxPreviewDocument } from "../../src/chat/response-spec";
import { HOWLIL_FLAT_PREVIEW_CSS } from "../../src/chat/preview-design-tokens";

test("HTML preview uses local howlil-app flat light tokens without remote resources", () => {
  const html = createNoxPreviewDocument("html-preview", "<section><h2>Preview</h2><button>Next</button></section>", "safe-id");
  assert.ok(html);
  for (const token of ["#FEFEFE", "#F7F7F7", "#121212", "#BFBFBF", "#9BB1FF", "color-scheme: light"]) {
    assert.ok(html.includes(token), token);
  }
  assert.ok(html.includes('<main id="nox-preview-content">'));
  assert.ok(html.includes("ResizeObserver"));
  assert.ok(html.includes("getBoundingClientRect().height"));
  assert.ok(html.includes("document.getElementById('nox-preview-content')"));
  assert.doesNotMatch(html, /documentElement\.scrollHeight/);
  assert.doesNotMatch(HOWLIL_FLAT_PREVIEW_CSS, /(?:linear|radial)-gradient/);
  assert.ok(HOWLIL_FLAT_PREVIEW_CSS.includes("box-shadow: none;"));
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
});

test("light preview preset applies to JS and SVG without enabling SVG scripts", () => {
  const js = createNoxPreviewDocument("js-preview", 'console.log("ready")', "code-id");
  const svg = createNoxPreviewDocument("svg-preview", '<svg viewBox="0 0 10 10"/>', "svg-id");
  assert.match(js ?? "", /color-scheme: light/);
  assert.match(svg ?? "", /color-scheme: light/);
  assert.ok(js?.includes("nox-preview-content"));
  assert.match(svg ?? "", /script-src 'none'/);
  assert.ok(!svg?.includes("nox-preview-resize"));
});

test("existing full HTML source remains unwrapped for backward compatibility", () => {
  const source = "<!doctype html><html><body><h2>Old demo</h2></body></html>";
  const html = createNoxPreviewDocument("html-preview", source, "safe");
  assert.ok(html?.includes(source));
  assert.ok(!html?.includes('<main id="nox-preview-content">'));
});

test("model guidance requests progressive single-question UI only for HTML previews", () => {
  const prompt = buildActionInstruction("ask");
  assert.match(prompt, /howlil-app flat\/light tokens/);
  assert.match(prompt, /nox-quiz JSON/);
  assert.match(prompt, /NOX owns one-at-a-time Next\/Previous/);
  assert.match(prompt, /bespoke HTML quiz/);
  assert.match(prompt, /no dark-mode variants/);
  assert.match(prompt, /avoid fixed heights/);
  assert.doesNotMatch(buildActionInstruction("review"), /nox-quiz JSON/);
  assert.match(buildPracticeQuestionInstruction("java"), /Generate exactly one active-recall question/);
});
