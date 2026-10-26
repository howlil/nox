import assert from "node:assert/strict";
import test from "node:test";
import { checkHostConsumption, validateHostConsumption } from "../../scripts/check-host-consumption.mjs";

const canonical = ["packages/core/src/domain/practice/types.ts"];
test("host graph disallows direct imports through an obsolete source shim", () => {
  const path = "src/host/obsidian/adapter.ts";
  const bad = [{ path, source: 'import type { PracticeAnswer } from "../../domain/practice/types";' }];
  assert.match(validateHostConsumption(bad, canonical)[0] ?? "", /legacy core shim/);
  assert.deepEqual(validateHostConsumption([{ path,
    source: 'import type { PracticeAnswer } from "../../../packages/core/src/domain/practice/types";' }], canonical), []);
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
    for (const source of [
      'import type { AgentAdapter } from "../../packages/core/src/types";',
      'export { ProgramWriteConflict } from "../../packages/core/src/domain/persistence/errors";',
      'import { validateProgram } from "@nox/core/domain/learning-program/collection-schema";',
    ]) {
      assert.match(validateHostConsumption([{ path, source }], [])[0] ?? "",
        /must use the @nox\/core public API/);
    }
    assert.deepEqual(validateHostConsumption([{ path, source:
      'const sample = \'import { AgentAdapter } from "../../packages/core/src/types"\';' }], []), []);
  }
});
