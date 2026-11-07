import assert from "node:assert/strict";
import test from "node:test";
import { ProgramWriteConflict as CanonicalConflict } from "../../packages/core/src/domain/persistence/errors";
import { ProgramWriteConflict as LegacyConflict } from "../../src/domain/persistence/errors";
import { LearningController as CanonicalLearning } from "../../packages/core/src/application/LearningController";
import { LearningController as LegacyLearning } from "../../src/application/LearningController";
import { LearningProgramOrchestrator as CanonicalPrograms } from "../../packages/core/src/application/LearningProgramOrchestrator";
import { LearningProgramOrchestrator as LegacyPrograms } from "../../src/application/LearningProgramOrchestrator";
import { SessionController as CanonicalSessions } from "../../packages/core/src/session/SessionController";
import { SessionController as LegacySessions } from "../../src/session/SessionController";
import { AgentRuntime as CanonicalRuntime } from "../../packages/core/src/agent/AgentRuntime";
import { AgentRuntime as LegacyRuntime } from "../../src/agent/AgentRuntime";
import { checkPhysicalDomain } from "../../scripts/check-physical-domain.mjs";
import { auditLegacyCoreShims, RETIRED_CORE_SHIMS } from "../../scripts/check-core-shims.mjs";

test("M10 canonical domain and application constructors have one runtime identity", () => {
  assert.strictEqual(CanonicalConflict, LegacyConflict);
  assert.strictEqual(CanonicalLearning, LegacyLearning);
  assert.strictEqual(CanonicalPrograms, LegacyPrograms);
  assert.strictEqual(CanonicalSessions, LegacySessions);
  assert.strictEqual(CanonicalRuntime, LegacyRuntime);
  assert.ok(new LegacyConflict() instanceof CanonicalConflict);
});

test("M10 physically extracted core rejects duplicated logic or outward dependency", () => {
  assert.deepEqual(checkPhysicalDomain(), []);
});


test("M13 retired core shims cannot silently return", () => {
  assert.equal(RETIRED_CORE_SHIMS.size, 38);
  const inventory = auditLegacyCoreShims();
  // The migration tracks the actual number of remaining compatibility files.
  assert.equal(inventory.retained.length + inventory.unused.length, 20);
  assert.deepEqual(inventory.reintroduced, []);
  assert.deepEqual(inventory.missingReferenced, []);
});
