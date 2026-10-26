import assert from "node:assert/strict";
import test from "node:test";
import { posix } from "node:path";
import { checkHostConsumption, validateHostConsumption } from "../../scripts/check-host-consumption.mjs";

const canonical = ["packages/core/src/domain/practice/types.ts"];
test("host graph disallows direct imports through an obsolete source shim", () => {
  const path = "src/host/obsidian/adapter.ts";
  const bad = [{ path, source: 'import type { PracticeAnswer } from "../../domain/practice/types";' }];
  assert.match(validateHostConsumption(bad, canonical)[0] ?? "", /legacy core shim/);
  assert.match(validateHostConsumption([{ path,
    source: 'import type { PracticeAnswer } from "../../../packages/core/src/domain/practice/types";' }], canonical)[0] ?? "",
    /must use the @nox\/core public API/);
});

test("host graph rejects type-only and re-export shim edges without parsing string literals", () => {
  const path = "src/host/obsidian/adapter.ts";
  assert.equal(validateHostConsumption([{ path,
    source: 'export type { PracticeAnswer } from "../../domain/practice/types";' }], canonical).length, 1);
  assert.deepEqual(validateHostConsumption([{ path,
    source: 'const text = `import type { T } from "../../domain/practice/types"`;' }], canonical), []);
});

test("all production host and adapter source uses canonical core directly", () => {
  assert.deepEqual(checkHostConsumption(), []);
});

test("M11.1 context adapters reject package-private imports", () => {
  for (const path of ["src/context/ObsidianContext.ts", "src/context/PolicyLoader.ts"]) {
    assert.deepEqual(validateHostConsumption([{ path,
      source: 'import { LocalResearchIndex } from "@nox/core";' }], []), []);
    for (const source of [
      'import type { LearningPolicy } from "../../packages/core/src/context/context-types";',
      'export { LocalResearchIndex } from "../../packages/core/src/context/LocalResearch";',
      'import { LocalResearchIndex } from "@nox/core/context/LocalResearch";',
    ]) {
      assert.match(validateHostConsumption([{ path, source }], [])[0] ?? "",
        /must use the @nox\/core public API/);
    }
    assert.deepEqual(validateHostConsumption([{ path,
      source: 'const example = \'import { X } from "../../packages/core/src/X"\';' }], []), []);
  }
});

test("M11.2 provider and persistence adapters consume no private core paths", () => {
  const adapters = [
    "src/agent/ChatGptAdapter.ts",
    "src/agent/CodexAdapter.ts",
    "src/agent/AgyAdapter.ts",
    "src/persistence/VaultLearningStore.ts",
    "src/persistence/VaultProgramStore.ts",
    "src/persistence/PluginDataRepository.ts",
    "src/persistence/OnboardingStateRepository.ts",
    "src/host/obsidian/lifecycle.ts",
  ];
  for (const path of adapters) {
    const approved = [{ path, source: 'import type { AgentAdapter } from "@nox/core";' }];
    assert.deepEqual(validateHostConsumption(approved, []), []);
    const typePath = posix.relative(posix.dirname(path), "packages/core/src/types");
    const conflictPath = posix.relative(posix.dirname(path), "packages/core/src/domain/persistence/errors");
    for (const source of [
      `import type { AgentAdapter } from "${typePath}";`,
      `export { ProgramWriteConflict } from "${conflictPath}";`,
      'import { validateProgram } from "@nox/core/domain/learning-program/collection-schema";',
    ]) {
      assert.match(validateHostConsumption([{ path, source }], [])[0] ?? "",
        /must use the @nox\/core public API/);
    }
    assert.deepEqual(validateHostConsumption([{ path, source:
      'const sample = \'import { AgentAdapter } from "../../packages/core/src/types"\';' }], []), []);
  }
});

test("M11.3 presenter and chat UI adapters use only the public core entrypoint", () => {
  const presenters = [
    "src/chat/ChatView.ts",
    "src/features/learning/view/LearningPresenter.ts",
    "src/features/practice/view/PracticePresenter.ts",
    "src/chat/learning-panel-state.ts",
    "src/chat/learning-graph.ts",
    "src/chat/learning-card-renderers.ts",
    "src/features/conversation/view/history-presenter.ts",
    "src/features/conversation/view/transcript-presenter.ts",
    "src/chat/chat-state.ts",
  ];
  for (const path of presenters) {
    assert.deepEqual(validateHostConsumption([{ path,
      source: 'import type { NoxProgramOverview } from "@nox/core";' }], []), []);
    const privatePath = posix.relative(posix.dirname(path), "packages/core/src/application/learning-types");
    const privateRuntimePath = posix.relative(posix.dirname(path), "packages/core/dist/index.mjs");
    for (const source of [
      `import type { NoxProgramOverview } from "${privatePath}";`,
      `export type { LearningActionKind } from "${privatePath}";`,
      `import { LearningController } from "${privateRuntimePath}";`,
      'import { isLocallyExecutableCommand } from "@nox/core/application/local-command";',
    ]) {
      assert.match(validateHostConsumption([{ path, source }], [])[0] ?? "",
        /must use the @nox\/core public API/);
    }
    assert.deepEqual(validateHostConsumption([{ path, source:
      `const example = 'import { X } from "../../packages/core/src/index"';` }], []), []);
  }
});

test("M11.4 fail-closed host guard applies to newly added modules and import forms", () => {
  const paths = [
    "src/new-feature/FutureView.ts",
    "src/mutation/FutureAdapter.ts",
    "headless/src/NewRunner.ts",
    "browser/src/NewRuntime.ts",
  ];
  for (const path of paths) {
    const privatePath = posix.relative(posix.dirname(path), "packages/core/src/domain/practice/types");
    for (const source of [
      `import type { PracticeAnswer } from "${privatePath}";`,
      `export type { PracticeAnswer } from "${privatePath}";`,
      'import { LearningController } from "@nox/core/application/LearningController";',
    ]) {
      assert.match(validateHostConsumption([{ path, source }], canonical)[0] ?? "",
        /must use the @nox\/core public API/);
    }
    assert.deepEqual(validateHostConsumption([{ path,
      source: 'import type { PracticeAnswer } from "@nox/core";' }], canonical), []);
  }
  // Legacy compatibility facades are not host implementations. They are
  // tracked separately by the referenced-shim inventory.
  const shimPath = "src/domain/practice/types.ts";
  assert.deepEqual(validateHostConsumption([{ path: shimPath,
    source: 'export type { PracticeAnswer } from "../../../packages/core/src/domain/practice/types";' }], canonical), []);
});
