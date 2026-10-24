import assert from "node:assert/strict";
import test from "node:test";
import { validateArchitecture } from "../../scripts/boundaries.mjs";

test("M3 host package is a one-way dependency leaf for application and domain", () => {
  const sources = [
    { path: "src/host/obsidian/composition.ts",
      source: 'import { SessionController } from "../../session/SessionController";' },
    { path: "src/session/SessionController.ts", source: "" },
    { path: "src/application/LearningController.ts",
      source: 'import { createObsidianLearningHost } from "../host/obsidian/composition";' },
    { path: "src/domain/practice/FutureRule.ts",
      source: 'import { createObsidianLearningHost } from "../../host/obsidian/composition";' },
  ];
  const rejected = validateArchitecture(sources);
  assert.equal(rejected.filter(x => x.includes("forbidden dependency")).length, 2);
  assert.deepEqual(validateArchitecture(sources.slice(0, 2)), []);
});

test("M3 unknown host subtypes fail rather than acquiring Obsidian authority", () => {
  const rejected = validateArchitecture([
    { path: "src/host/web/Unsafe.ts", source: 'import type { A } from "../../types";' },
    { path: "src/types.ts", source: "" },
  ]);
  assert.ok(rejected.some(x => x.includes("forbidden dependency")));
});
