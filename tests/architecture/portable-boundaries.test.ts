import assert from "node:assert/strict";
import test from "node:test";
import { isPortableSource, PORTABLE_CONTRACT_FILES, validatePortableBoundaries } from "../../scripts/portable-boundaries.mjs";

const rule = (source: string, path = "src/domain/practice/NewRule.ts") => ({ path, source });

test("M0 protects all domain files and explicitly declared shared contracts", () => {
  assert.equal(isPortableSource("src/domain/practice/FutureRule.ts"), true);
  assert.equal(isPortableSource("src/application/ports.ts"), true);
  assert.equal(isPortableSource("src/context/ContextResolver.ts"), true);
  assert.equal(isPortableSource("src/application/RunLearningTurn.ts"), false,
    "M0 must not falsely claim the unextracted orchestrator is portable");
  assert.ok(PORTABLE_CONTRACT_FILES.includes("src/session/transcript-types.ts"));
});

test("M0 permits pure domain imports, including type-only contracts", () => {
  const files = [
    rule('export type { T } from "./types";'),
    rule("export type T = string;", "src/domain/practice/types.ts"),
  ];
  assert.deepEqual(validatePortableBoundaries(files), []);
});

test("M0 rejects static, type-only and re-export imports from host packages", () => {
  for (const source of [
    'import { Plugin } from "obsidian";',
    'import type { Plugin } from "obsidian";',
    'export { Plugin } from "obsidian";',
    'import { readFileSync } from "node:fs";',
    'import type { Foo } from "electron";',
    'type Host = import("obsidian").Plugin;',
  ]) {
    assert.ok(validatePortableBoundaries([rule(source)]).some((x: string) =>
      x.includes("portable module cannot import")), source);
  }
});

test("M0 rejects dynamic imports and require(), including computed specifiers", () => {
  for (const source of [
    'const io = import("node:fs");',
    'const io = import(name);',
    'const io = require("fs");',
    'const io = require(name);',
  ]) {
    assert.ok(validatePortableBoundaries([rule(source)]).length > 0, source);
  }
});

test("M0 refuses concrete host adapters even via relative type imports", () => {
  const files = [
    rule('import type { A } from "../../context/ObsidianContext";'),
    rule("export type A = number;", "src/context/ObsidianContext.ts"),
  ];
  assert.ok(validatePortableBoundaries(files).some((x: string) =>
    x.includes("nonportable source src/context/ObsidianContext.ts")));
});

test("M0 refuses missing dependencies and deleted declared contract files", () => {
  const files = [rule('import type { Missing } from "./Missing";')];
  assert.ok(validatePortableBoundaries(files).some((x: string) =>
    x.includes("unresolved portable dependency")));
  assert.ok(validatePortableBoundaries(files, { requireManifest: true }).some((x: string) =>
    x.includes("src/application/ports.ts: declared portable contract file is missing")));
});

test("M0 rejects host globals while ignoring comments, strings and object keys", () => {
  for (const source of [
    "const root = window.location;",
    "document.querySelector('p');",
    "const storage = globalThis['localStorage'];",
    "const location = globalThis.navigator;",
    "const pid = process.pid;",
    "type Element = HTMLElement;",
  ]) {
    assert.ok(validatePortableBoundaries([rule(source)]).length > 0, source);
  }
  assert.deepEqual(validatePortableBoundaries([rule(`
    // document window require("fs") must never count as code
    export const info = { process: "process-failed", window: "window" };
  `)]), []);
});

test("M0 protects existing structural application contracts without moving runtime code", () => {
  const files = [
    rule('import type { Domain } from "../domain/practice/types";',
      "src/application/ports.ts"),
    rule("export type Domain = string;", "src/domain/practice/types.ts"),
  ];
  assert.deepEqual(validatePortableBoundaries(files), []);
});
