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
