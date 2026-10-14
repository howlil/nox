import assert from "node:assert/strict";
import test from "node:test";
import {
  createNoxPreviewDocument,
  parseNoxChart,
  visualKindFromClasses,
  MAX_VISUAL_SOURCE_CHARS,
} from "../../src/chat/response-spec";

test("only explicitly opted-in fences become interactive visuals", () => {
  assert.equal(visualKindFromClasses(["language-html"]), null);
  assert.equal(visualKindFromClasses(["language-javascript"]), null);
  assert.equal(visualKindFromClasses(["language-html-preview"]), "html-preview");
  assert.equal(visualKindFromClasses(["language-svg-preview"]), "svg-preview");
  assert.equal(visualKindFromClasses(["language-nox-chart"]), "nox-chart");
});

test("charts validate structure, length, type and bounded numeric values", () => {
  assert.deepEqual(parseNoxChart(JSON.stringify({
    type: "bar", labels: ["Jan", "Feb"], values: [0, 13], title: "Registrations",
  })), { type: "bar", labels: ["Jan", "Feb"], values: [0, 13], title: "Registrations" });
  assert.equal(parseNoxChart('{"type":"pie","labels":["A"],"values":[1]}'), null);
  assert.equal(parseNoxChart('{"type":"bar","labels":["A"],"values":[-1]}'), null);
  assert.equal(parseNoxChart('{"type":"bar","labels":["A"],"values":[1,2]}'), null);
  assert.equal(parseNoxChart('{"type":"bar","labels":["A"],"values":["<script>"]}'), null);
  assert.equal(parseNoxChart('{"type":"bar","labels":[],"values":[]}'), null);
  assert.equal(parseNoxChart('{"type":"bar","labels":["A"],"values":[1e100]}'), null);
  assert.equal(parseNoxChart("not json"), null);
  assert.equal(parseNoxChart("x".repeat(MAX_VISUAL_SOURCE_CHARS + 1)), null);
  assert.equal(parseNoxChart(JSON.stringify({
    type: "line", labels: Array(17).fill("A"), values: Array(17).fill(1),
  })), null);
});

test("sandbox HTML allows local inline scripts but blocks external resources", () => {
  const source = '<button onclick="this.textContent=2">Click</button>';
  const doc = createNoxPreviewDocument("html-preview", source);
  assert.ok(doc?.includes(source));
  assert.ok(doc?.includes("default-src 'none'"));
  assert.ok(doc?.includes("connect-src 'none'"));
  assert.ok(doc?.includes("form-action 'none'"));
  assert.ok(doc?.includes("script-src 'unsafe-inline'"));
  assert.ok(!doc?.includes("allow-same-origin"));
  assert.equal(createNoxPreviewDocument("html-preview", " "), null);
  assert.equal(createNoxPreviewDocument("html-preview", "a".repeat(MAX_VISUAL_SOURCE_CHARS + 1)), null);
});

test("SVG preview disallows scripts", () => {
  const doc = createNoxPreviewDocument("svg-preview", "<svg><circle r='2'/></svg>");
  assert.ok(doc?.includes("script-src 'none'"));
  assert.ok(doc?.includes("<svg>"));
});
