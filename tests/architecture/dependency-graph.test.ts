import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSources, extractImports, formatMarkdown } from "../../scripts/architecture-graph.mjs";

test("AST parser follows imports, re-exports, import types and literal dynamic imports", () => {
  const source = [
    'import type { Config } from "../domain/config";',
    'import { run } from "../application/run";',
    'export { type Rule } from "../domain/rule";',
    'export * from "./public";',
    'type Snapshot = import("../domain/config").Config;',
    'const lazy = import("./lazy");',
    'const loader = require("./public");',
    '// import "./fake-comment";',
    'const text = "import \\"./fake-string\\"";',
  ].join("\n");
  const parsed = extractImports("src/chat/ChatView.ts", source);
  assert.deepEqual(parsed.imports.map((value) => [value.specifier, value.kind]), [
    ["../domain/config", "type"],
    ["../application/run", "runtime"],
    ["../domain/rule", "type"],
    ["./public", "runtime"],
    ["../domain/config", "type"],
    ["./lazy", "runtime"],
    ["./public", "runtime"],
  ]);
  assert.deepEqual(parsed.dynamic, []);
});

test("graph resolves existing relative modules and preserves runtime/type edge distinctions", () => {
  const report = analyzeSources([
    { path: "src/chat/ChatView.ts", source:
      'import { go } from "../application/run";\n' +
      'import type { Config } from "../domain/config";\n' +
      'import { other } from "./../application/run";\n' +
      'import { Notice } from "obsidian";' },
    { path: "src/application/run.ts", source: 'export const go = () => {}; export const other = go;' },
    { path: "src/domain/config.ts", source: "export interface Config {}" },
  ]);
  assert.equal(report.summary.files, 3);
  assert.equal(report.summary.internalEdges, 2);
  assert.equal(report.summary.runtimeEdges, 1);
  assert.equal(report.summary.typeEdges, 1);
  assert.equal(report.summary.crossOwnerEdges, 2);
  assert.equal(report.summary.externalImports, 1);
  assert.deepEqual(report.ownerEdges, [
    { edge: "chat -> application", count: 1 },
    { edge: "chat -> domain", count: 1 },
  ]);
  assert.deepEqual(report.hubs.find((node) => node.path === "src/chat/ChatView.ts")?.fanOut, 2);
  assert.equal(report.summary.cycles, 0);
});

test("cycles report strongly connected groups rather than arbitrary back-edges", () => {
  const report = analyzeSources([
    { path: "src/agent/A.ts", source: 'import "./B";' },
    { path: "src/agent/B.ts", source: 'import "./C";' },
    { path: "src/agent/C.ts", source: 'export * from "./A";' },
    { path: "src/agent/Standalone.ts", source: "export {};" },
  ]);
  assert.deepEqual(report.cycles, [[
    "src/agent/A.ts", "src/agent/B.ts", "src/agent/C.ts",
  ]]);
  assert.equal(report.summary.cycles, 1);
});

test("unresolved relative imports and computed dynamic imports are surfaced, not silently ignored", () => {
  const report = analyzeSources([
    { path: "src/context/context.ts", source:
      'import "../missing";\n' +
      'const loader = import(providerName);\n' +
      'const other = require(variable);\n' +
      'const ok = import("./exists.js");' },
    { path: "src/context/exists.ts", source: "export const exists = true;" },
  ]);
  assert.equal(report.summary.unresolved, 1);
  assert.deepEqual(report.unresolved[0], {
    from: "src/context/context.ts", specifier: "../missing", line: 1,
  });
  assert.equal(report.summary.dynamic, 2);
  assert.deepEqual(report.dynamic.map((x) => x.line), [2, 3]);
  assert.deepEqual(report.edges.map((edge) => edge.to), ["src/context/exists.ts"]);
});

test("graph output is stable regardless of source input order", () => {
  const files = [
    { path: "src/session/b.ts", source: 'export * from "./a";' },
    { path: "src/session/a.ts", source: 'import type { T } from "./b";' },
  ];
  const forward = analyzeSources(files);
  const reverse = analyzeSources(files.slice().reverse());
  assert.deepEqual(forward, reverse);
  assert.equal(formatMarkdown(forward), formatMarkdown(reverse));
});

test("duplicate module paths are rejected and comments are not counted as edges", () => {
  assert.throws(() => analyzeSources([
    { path: "src/domain/a.ts", source: "" },
    { path: "src/domain/a.ts", source: "" },
  ]), /Duplicate source paths/);
  const report = analyzeSources([{
    path: "src/domain/a.ts",
    source: '// import "obsidian";\nconst hint = "require(\\"fs\\")";\nexport {};',
  }]);
  assert.equal(report.summary.externalImports, 0);
  assert.equal(report.summary.internalEdges, 0);
});

test("M5 graph counts private feature packages separately and reveals cross-package edges", () => {
  const report = analyzeSources([
    { path: "src/application/RunLearningTurn.ts",
      source: 'import { Buffer } from "../features/conversation/turn/StructuredTurnBuffer";' },
    { path: "src/features/conversation/turn/StructuredTurnBuffer.ts",
      source: 'import type { State } from "../../../domain/practice/types"; export class Buffer {}' },
    { path: "src/domain/practice/types.ts", source: "export interface State {}" },
    { path: "src/features/learning/program/ProgramMutationQueue.ts", source: "export class Queue {}" },
  ]);
  assert.deepEqual(report.owners, [
    { owner: "application", files: 1 },
    { owner: "domain", files: 1 },
    { owner: "features/conversation/turn", files: 1 },
    { owner: "features/learning/program", files: 1 },
  ]);
  assert.equal(report.summary.crossOwnerEdges, 2);
  assert.ok(report.ownerEdges.some(edge =>
    edge.edge === "application -> features/conversation/turn" && edge.count === 1));
});
