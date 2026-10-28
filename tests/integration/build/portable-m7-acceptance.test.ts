import assert from "node:assert/strict";
import test from "node:test";
import {
  portableAcceptanceIssues, summarizePortableAcceptance, checkPortableAcceptance,
} from "../../../scripts/check-portable-acceptance.mjs";

const manifest = {
  name: "@nox/core", private: true,
  exports: { ".": { import: "./dist/index.mjs", require: "./dist/index.cjs",
    types: "./dist/types/packages/core/src/index.d.ts" } },
};
const ci = [
  "pnpm install --frozen-lockfile", "pnpm check:boundaries", "pnpm typecheck",
  "pnpm lint", "pnpm test:unit", "pnpm test:integration",
  "pnpm core:verify", "pnpm core:hosts", "pnpm browser:verify",
  "pnpm build", "pnpm test:artifacts", "pnpm test:plugin-runtime",
].join("\n");
const release = [
  "needs: [detect, linux, windows, community]",
  "gh attestation verify", "Source ref moved", "remote asset allowlist",
].join("\n");
const recovery = [
  "gh attestation verify", "node scripts/check-release.mjs", "EXPECTED_SHA",
].join("\n");
const factory = () => ({
  ci, release, recovery, core: manifest,
  tsconfig: { compilerOptions: { paths: { "@nox/core": ["packages/core/src/index.ts"] } } },
  source: ["LearningController", "SessionController", "SessionStore", "AgentRuntime"]
    .map(name => "export { " + name + " }").join("\n"),
});

test("portable core acceptance validates automated configuration, not human artifacts", () => {
  assert.deepEqual(portableAcceptanceIssues(factory()), []);
  const report = summarizePortableAcceptance({ issues: [] });
  assert.equal(report.configuration, "PASS");
  assert.equal(report.completedCiVerified, false);
});

test("publication fails policy preflight when certification or provenance is missing", () => {
  const changed = factory();
  changed.ci = changed.ci.replace("pnpm browser:verify", "");
  changed.release = "needs: [detect, linux]";
  changed.recovery = "";
  changed.core = { ...manifest, private: false };
  changed.tsconfig = { compilerOptions: { paths: {} } };
  const issues = portableAcceptanceIssues(changed);
  assert.ok(issues.some(x => x.includes("pnpm browser:verify")));
  assert.ok(issues.some(x => x.includes("Linux, Windows, and Community")));
  assert.ok(issues.some(x => x.includes("Publication provenance")));
  assert.ok(issues.some(x => x.includes("Recovery provenance")));
  assert.ok(issues.some(x => x.includes("private")));
  assert.ok(issues.some(x => x.includes("source-alias")));
  assert.equal(summarizePortableAcceptance({ issues }).configuration, "FAIL");
});

test("same-head CI cannot be inferred from a passing configuration check", () => {
  assert.equal(summarizePortableAcceptance({ issues: [] }).completedCiVerified, false);
});

test("repository portable preflight retains release certification checks", () => {
  const report = checkPortableAcceptance();
  assert.equal(report.configuration, "PASS");
  assert.equal(report.completedCiVerified, false);
});

test("portable preflight recognizes grouped named exports, not comments", () => {
  const grouped = {
    ...factory(),
    source: [
      'export { LearningController, OnboardingReceiptWriteError } from "./application/LearningController";',
      'export { SessionController } from "./session/SessionController";',
      'export { SessionStore } from "./session/SessionStore";',
      'export { AgentRuntime } from "./agent/AgentRuntime";',
    ].join("\n"),
  };
  assert.deepEqual(portableAcceptanceIssues(grouped), []);
  const hidden = { ...grouped, source: grouped.source.replace(
    'export { LearningController, OnboardingReceiptWriteError }',
    'const text = "export { LearningController }"; export { OnboardingReceiptWriteError }',
  ) };
  assert.ok(portableAcceptanceIssues(hidden)
    .some(issue => issue.includes("public API missing: LearningController")));
});

