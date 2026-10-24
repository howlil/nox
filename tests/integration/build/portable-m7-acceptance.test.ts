import assert from "node:assert/strict";
import test from "node:test";
import {
  portableAcceptanceIssues, summarizePortableAcceptance, checkPortableAcceptance,
} from "../../../scripts/check-portable-acceptance.mjs";

const manifest = { name: "@nox/core", private: true,
  exports: { ".": { import: "./dist/index.mjs", require: "./dist/index.cjs",
    types: "./dist/types/packages/core/src/index.d.ts" } } };
const ci = [
  "pnpm install --frozen-lockfile", "pnpm check:boundaries", "pnpm typecheck",
  "pnpm lint", "pnpm test:unit", "pnpm test:integration",
  "pnpm core:verify", "pnpm core:hosts", "pnpm browser:verify",
  "pnpm build", "pnpm test:artifacts",
].join("\n");
const release = "desktop-acceptance:\nnode scripts/verify-desktop-acceptance.mjs\n" +
  "needs: [detect, linux, windows, community, desktop-acceptance]";
const factory = () => ({
  ci, release, recovery: "node scripts/verify-desktop-acceptance.mjs",
  core: manifest,
  tsconfig: { compilerOptions: { paths: { "@nox/core": ["packages/core/src/index.ts"] } } },
  source: ["LearningController", "SessionController", "SessionStore", "AgentRuntime"]
    .map(name => "export { " + name + " }").join("\n"),
});

test("M7 automated acceptance does not fabricate native desktop PASS", () => {
  assert.deepEqual(portableAcceptanceIssues(factory()), []);
  const report = summarizePortableAcceptance({ issues: [], nativeStatus: "NOT RUN" });
  assert.equal(report.automated, "PASS");
  assert.equal(report.mergeReady, false);
  assert.equal(report.native, "NOT RUN");
});

test("M7 blocks missing browser checks, public core and missing native release checks", () => {
  const changed = factory();
  changed.ci = changed.ci.replace("pnpm browser:verify", "");
  changed.release = "desktop-acceptance:";
  changed.recovery = "";
  changed.core = { ...manifest, private: false };
  changed.tsconfig = { compilerOptions: { paths: {} } };
  const issues = portableAcceptanceIssues(changed);
  assert.ok(issues.some(issue => issue.includes("pnpm browser:verify")));
  assert.ok(issues.some(issue => issue.includes("publication gate")));
  assert.ok(issues.some(issue => issue.includes("Recovery publication")));
  assert.ok(issues.some(issue => issue.includes("private")));
  assert.ok(issues.some(issue => issue.includes("source-alias")));
  assert.equal(summarizePortableAcceptance({ issues, nativeStatus: "PASS" }).mergeReady, false);
});

test("M7 requires separately verified complete same-head CI plus native evidence", () => {
  assert.equal(summarizePortableAcceptance({
    issues: [], nativeStatus: "PASS",
  }).mergeReady, false, "preflight cannot treat future CI steps as already passed");
  assert.equal(summarizePortableAcceptance({
    issues: [], nativeStatus: "PASS", ciRunVerified: true,
  }).mergeReady, true);
  assert.equal(summarizePortableAcceptance({
    issues: ["failed build"], nativeStatus: "PASS", ciRunVerified: true,
  }).mergeReady, false);
  assert.equal(summarizePortableAcceptance({
    issues: [], nativeStatus: "NOT RUN", ciRunVerified: true,
  }).mergeReady, false);
});

test("M7 repository preflight reports native acceptance as NOT RUN", () => {
  const report = checkPortableAcceptance();
  assert.equal(report.automated, "PASS");
  assert.equal(report.native, "NOT RUN");
  assert.equal(report.mergeReady, false);
});
