import assert from "node:assert/strict";
import test from "node:test";
import { PracticeStateMachine as CanonicalPractice } from "../../packages/core/src/domain/practice/PracticeStateMachine";
import { PracticeStateMachine as LegacyPractice } from "../../src/domain/practice/PracticeStateMachine";
import { ProgramWriteConflict as CanonicalConflict } from "../../packages/core/src/domain/persistence/errors";
import { ProgramWriteConflict as LegacyConflict } from "../../src/domain/persistence/errors";
import { validateCurriculum as canonicalValidate } from "../../packages/core/src/domain/learning-program/rules";
import { validateCurriculum as legacyValidate } from "../../src/domain/learning-program/rules";
import { checkPhysicalDomain } from "../../scripts/check-physical-domain.mjs";

test("M10 one canonical domain constructor and pure policy identity", () => {
  assert.strictEqual(CanonicalPractice, LegacyPractice);
  assert.strictEqual(CanonicalConflict, LegacyConflict);
  assert.strictEqual(canonicalValidate, legacyValidate);
  assert.ok(new LegacyConflict() instanceof CanonicalConflict);
});

test("M10 physical domain migration preserves all ownership edges", () => {
  assert.deepEqual(checkPhysicalDomain(), []);
});
