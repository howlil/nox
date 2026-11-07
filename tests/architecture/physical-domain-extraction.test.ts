import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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


for (const newline of ["\n", "\r\n"]) {
  test(`core facade accepts ${newline === "\n" ? "LF" : "CRLF"} without allowing extra logic`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "nox-facade-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const write = (path: string, source: string) => {
      const filename = join(root, path);
      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, source);
    };
    write("packages/core/src/domain/value.ts", "export const value = 1;\n");
    write("packages/core/src/index.ts", 'export * from "./domain/value";\n');
    const facade = 'export * from "../../packages/core/src/domain/value";' + newline;
    write("src/domain/value.ts", facade);
    assert.deepEqual(checkPhysicalDomain(root), []);
    write("src/domain/value.ts", facade + "export const duplicate = 2;" + newline);
    assert.ok(checkPhysicalDomain(root).some(issue => issue.includes("invalid compatibility shim")));
    write("src/domain/value.ts", 'export * from "./wrong-owner";' + newline);
    assert.ok(checkPhysicalDomain(root).some(issue => issue.includes("invalid compatibility shim")));
  });
}

test("M13 retired core shims cannot silently return", () => {
  assert.equal(RETIRED_CORE_SHIMS.size, 40);
  const inventory = auditLegacyCoreShims();
  // The migration tracks the actual number of remaining compatibility files.
  assert.equal(inventory.retained.length + inventory.unused.length, 18);
  assert.deepEqual(inventory.reintroduced, []);
  assert.deepEqual(inventory.missingReferenced, []);
});
