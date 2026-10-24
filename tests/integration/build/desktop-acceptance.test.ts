import assert from "node:assert/strict";
import test from "node:test";
import { checkDesktopAcceptance, verifyDesktopAcceptanceFile,
  DESKTOP_ACCEPTANCE_CRITICAL_PATHS } from "../../../scripts/verify-desktop-acceptance.mjs";

const commit = "a".repeat(40);
const makeEvidence = () => ({
  version: "1.3.0", testedCommit: commit,
  platform: "win32", obsidianVersion: "1.13.0",
  reviewer: "desktop-reviewer", testedAt: "2026-10-20T10:00:00.000Z",
  cases: Array.from({ length: 10 }, (_, index) => ({
    id: "D" + String(index + 1).padStart(2, "0"),
    status: "PASS", evidenceUrl: "https://github.com/howlil/nox/issues/123",
  })),
});

test("missing desktop evidence fails closed, never fabricates PASS", () => {
  assert.throws(() => verifyDesktopAcceptanceFile("/missing/nox-desktop-evidence.json"), /NOT RUN/);
});

test("acceptance needs D01-D10 and a reviewed, source-bound native run", () => {
  const value = makeEvidence();
  const verified = checkDesktopAcceptance(value, { version: "1.3.0",
    isAncestor: sha => sha === commit, changesSince: () => false });
  assert.equal(verified.caseCount, 10);
  const incomplete = makeEvidence();
  incomplete.cases.pop();
  assert.throws(() => checkDesktopAcceptance(incomplete, { version: "1.3.0" }), /D01-D10/);
  const failed = makeEvidence();
  failed.cases[2].status = "FAIL";
  assert.throws(() => checkDesktopAcceptance(failed, { version: "1.3.0" }), /failed or unlinked/);
  const duplicate = makeEvidence();
  duplicate.cases[1].id = "D01";
  assert.throws(() => checkDesktopAcceptance(duplicate, { version: "1.3.0" }), /duplicated/);
});

test("acceptance rejects stale source, wrong version or non-GitHub evidence", () => {
  assert.throws(() => checkDesktopAcceptance(makeEvidence(), { version: "1.3.1" }), /version/);
  assert.throws(() => checkDesktopAcceptance(makeEvidence(), { version: "1.3.0",
    isAncestor: () => false, changesSince: () => false }), /not an ancestor/);
  assert.throws(() => checkDesktopAcceptance(makeEvidence(), { version: "1.3.0",
    isAncestor: () => true, changesSince: () => true }), /changed since/);
  const external = makeEvidence();
  external.cases[0].evidenceUrl = "https://arbitrary.example/pass";
  assert.throws(() => checkDesktopAcceptance(external, { version: "1.3.0" }), /unlinked/);
});

test("M7 source-bound desktop evidence covers package, browser, headless and build entrypoints", () => {
  const required = [
    "src", "browser", "headless", "packages/core", "public",
    "styles.css", "scripts", "tests", ".github/workflows",
    "esbuild.config.mjs", "package.json", "pnpm-lock.yaml",
    "pnpm-workspace.yaml", "tsconfig.json", "manifest.json", "versions.json",
  ];
  assert.deepEqual(DESKTOP_ACCEPTANCE_CRITICAL_PATHS, required);
  assert.equal(new Set(DESKTOP_ACCEPTANCE_CRITICAL_PATHS).size, required.length,
    "Every distinct runtime/build authority must have one acceptance path");
  assert.equal(DESKTOP_ACCEPTANCE_CRITICAL_PATHS.includes("docs/desktop-acceptance.json"), false,
    "Acceptance record itself must not invalidate the runtime evidence");
});
