import assert from "node:assert/strict";
import test from "node:test";
import { validateArchitecture } from "../../scripts/boundaries.mjs";

const base = [
  { path: "src/domain/practice/PracticeStateMachine.ts", source: "export class PracticeStateMachine {}" },
  { path: "src/application/RunLearningTurn.ts",
    source: 'import { PracticeStateMachine } from "../domain/practice/PracticeStateMachine";' },
];

test("domain and application may use owned domain contracts", () => {
  assert.deepEqual(validateArchitecture(base), []);
});
test("a new feature may not bypass the application boundary into persistence", () => {
  const files = [...base, { path: "src/persistence/VaultLearningStore.ts", source: "" },
    { path: "src/chat/FutureView.ts",
      source: 'import { VaultLearningStore } from "../persistence/VaultLearningStore";' }];
  assert.ok(validateArchitecture(files).some((message: string) => message.includes("forbidden dependency")));
});
test("domain cannot depend on Obsidian, a provider or presentation", () => {
  const files = [{ path: "src/domain/practice/NewRule.ts",
    source: 'import { App } from "obsidian";\nimport { ChatView } from "../../chat/ChatView";' },
  { path: "src/chat/ChatView.ts", source: "" }];
  assert.equal(validateArchitecture(files).length, 2);
});
test("application cannot reach into concrete persistence or Obsidian adapters", () => {
  const files = [...base, { path: "src/persistence/VaultLearningStore.ts", source: "" },
    { path: "src/context/ObsidianContext.ts", source: "" },
    { path: "src/application/FutureTurn.ts", source:
      'import { VaultLearningStore } from "../persistence/VaultLearningStore";\n' +
      'import { ObsidianContext } from "../context/ObsidianContext";' }];
  assert.equal(validateArchitecture(files).length, 2);
});
test("unknown directories, removed legacy paths and broken imports fail", () => {
  const files = [...base,
    { path: "src/helpers/RandomUtils.ts", source: "" },
    { path: "src/learning/OldPractice.ts", source: "" },
    { path: "src/chat/BadView.ts", source: 'import { X } from "../domain/nope";' }];
  assert.equal(validateArchitecture(files).length, 3);
});
test("application-owned port and normalized parser stay usable", () => {
  const files = [...base,
    { path: "src/application/ports.ts", source: "" },
    { path: "src/agent/StructuredStreamParser.ts", source: "" },
    { path: "src/application/FutureTurn.ts", source:
      'import type { SessionPort } from "./ports";\n' +
      'import { StructuredStreamParser } from "../agent/StructuredStreamParser";' }];
  assert.deepEqual(validateArchitecture(files), []);
});

test("guard handles type imports, dynamic imports and re-exports", () => {
  const files = [
    { path: "src/domain/practice/Code.ts", source:
      'const q = import("../../chat/FutureView");\n' +
      'type T = import("../../persistence/VaultLearningStore").VaultLearningStore;\n' +
      'export { X } from "../../ui/primitives";' },
    { path: "src/chat/FutureView.ts", source: "" },
    { path: "src/persistence/VaultLearningStore.ts", source: "" },
    { path: "src/ui/primitives.ts", source: "" },
  ];
  assert.equal(validateArchitecture(files).length, 3);
});
test("strings and comments that look like import statements are ignored", () => {
  const files = [{ path: "src/domain/practice/Code.ts",
    source: '// import { App } from "obsidian";\nconst sample = \'import("node:fs")\';' }];
  assert.deepEqual(validateArchitecture(files), []);
});
