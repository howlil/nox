import assert from "node:assert/strict";
import test from "node:test";
import {
  createNoxPreviewDocument,
  parseNoxChart,
  parseNoxCard,
  parseNoxFlow,
  visualKindFromClasses,
  MAX_VISUAL_SOURCE_CHARS,
} from "../../src/chat/response-spec";

test("only explicitly opted-in fences become interactive visuals", () => {
  assert.equal(visualKindFromClasses(["language-html"]), null);
  assert.equal(visualKindFromClasses(["language-javascript"]), null);
  assert.equal(visualKindFromClasses(["language-html-preview"]), "html-preview");
  assert.equal(visualKindFromClasses(["language-svg-preview"]), "svg-preview");
  assert.equal(visualKindFromClasses(["language-js-preview"]), "js-preview");
  assert.equal(visualKindFromClasses(["language-nox-chart"]), "nox-chart");
  assert.equal(visualKindFromClasses(["language-nox-flow"]), "nox-flow");
  assert.equal(visualKindFromClasses(["language-nox-card"]), "nox-card");
});

test("charts validate structure, length, type and bounded numeric values", () => {
  assert.deepEqual(parseNoxChart(JSON.stringify({
    type: "bar", labels: ["Jan", "Feb"], values: [0, 13], title: "Registrations",
  })), { type: "bar", labels: ["Jan", "Feb"], values: [0, 13], title: "Registrations" });
  assert.equal(parseNoxChart('{"type":"pie","labels":["A"],"values":[1]}'), null);
  assert.equal(parseNoxChart('{"type":"horizontal-bar","labels":["A"],"values":[8]}')?.type, "horizontal-bar");
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


test("top-down flow accepts bounded DAGs and rejects cycles, duplicates and unknown edges", () => {
  const valid = {
    version: 1, direction: "TB", layout: "vertical-stack",
    title: "NOX interaction",
    nodes: [{ id: "start", label: "NOX Sidebar" }, { id: "choice", label: "Thread state", kind: "decision" },
      { id: "quiz", label: "Interactive quiz", kind: "focus" }],
    edges: [{ from: "start", to: "choice" }, { from: "choice", to: "quiz" }],
  };
  assert.equal(parseNoxFlow(JSON.stringify(valid))?.nodes.length, 3);
  assert.equal(parseNoxFlow(JSON.stringify({ ...valid, direction: "LR" })), null);
  assert.equal(parseNoxFlow(JSON.stringify({ ...valid, edges: [...valid.edges, { from: "quiz", to: "start" }] })), null);
  assert.equal(parseNoxFlow(JSON.stringify({ ...valid, edges: [{ from: "start", to: "missing" }] })), null);
  assert.equal(parseNoxFlow(JSON.stringify({ ...valid, nodes: [...valid.nodes, valid.nodes[0]] })), null);
  assert.equal(parseNoxFlow(JSON.stringify({ ...valid, nodes: Array.from({ length: 25 }, (_, i) => ({ id: "n" + i, label: "Step" })) })), null);
  assert.equal(parseNoxFlow("not json"), null);
});

test("card schemas reject unsafe shapes and preserve literal values", () => {
  const spec = {
    version: 1, kind: "comparison", title: "AGENTS.md",
    items: [{ label: "Before", value: 9479, unit: "characters" }, { label: "After", value: 2438 }],
  };
  assert.equal(parseNoxCard(JSON.stringify(spec))?.items[0].value, 9479);
  assert.equal(parseNoxCard(JSON.stringify({ ...spec, kind: "status-table" }))?.kind, "status-table");
  assert.equal(parseNoxCard(JSON.stringify({ ...spec, items: [{ label: "A", value: Infinity }] })), null);
  assert.equal(parseNoxCard(JSON.stringify({ ...spec, items: [{ label: "A", value: -3, status: "fake" }] })), null);
  assert.equal(parseNoxCard(JSON.stringify({ ...spec, items: [] })), null);
  assert.equal(parseNoxCard(JSON.stringify({ ...spec, title: "x".repeat(121) })), null);
  assert.equal(parseNoxCard(JSON.stringify({ ...spec, kind: "script" })), null);
});

test("isolated JavaScript runner keeps source inside an opaque-origin frame", () => {
  const src = 'console.log("hello");';
  const doc = createNoxPreviewDocument("js-preview", src);
  assert.ok(doc?.includes("id=\"nox-output\""));
  assert.ok(doc?.includes(src));
  assert.ok(doc?.includes("connect-src 'none'"));
  assert.ok(doc?.includes("form-action 'none'"));
  assert.ok(doc?.includes("script-src 'unsafe-inline'"));
  assert.ok(!doc?.includes("allow-same-origin"));
  const escaped = createNoxPreviewDocument("js-preview",
    'console.log("</script><img src=x onerror=alert(1)>");');
  assert.ok(!escaped?.includes('console.log("</script>'));
});


test("sandbox preview reports dynamic height only for opted-in opaque frames", () => {
  const id = "nox-8b29a64a";
  const html = createNoxPreviewDocument("html-preview", "<p>Quiz</p>", id);
  assert.ok(html?.includes("ResizeObserver"));
  assert.ok(html?.includes("nox-preview-resize"));
  assert.ok(html?.includes(id));
  assert.ok(html?.includes("connect-src 'none'"));
  assert.ok(html?.includes("form-action 'none'"));
  const code = createNoxPreviewDocument("js-preview", "console.log(1)", id);
  assert.ok(code?.includes("ResizeObserver"));
  const svg = createNoxPreviewDocument("svg-preview", "<svg/>", id);
  assert.ok(!svg?.includes("ResizeObserver"));
  const invalid = createNoxPreviewDocument("html-preview", "<p>Quiz</p>", "<script>");
  assert.ok(!invalid?.includes("nox-preview-resize"));
});
