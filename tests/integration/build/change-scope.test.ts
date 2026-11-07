import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { classifyChanges, assertReleaseCertification } from "../../../scripts/ci/change-scope.mjs";

test("landing-only PRs have lightweight checks; mixed changes require plugin proof", () => {
  assert.deepEqual(classifyChanges({ eventName: "pull_request", files: ["landing/src/index.astro"] }),
    { plugin: false, release: false });
  assert.deepEqual(classifyChanges({ eventName: "pull_request", files: ["landing/README.md", "src/main.ts"] }),
    { plugin: true, release: false });
});

test("release scope includes version changes, release branches and policy changes", () => {
  for (const options of [
    { headRef: "release/1.3.3", files: ["CHANGELOG.md"] },
    { versionChanged: true, files: ["manifest.json"] },
    { files: [".release-plan.json"] },
    { files: [".github/workflows/ci.yml"] },
    { files: ["scripts/ci/change-scope.mjs"] },
    { files: ["scripts/ci/check-public-release.mjs"] },
  ]) {
    assert.deepEqual(classifyChanges({ eventName: "pull_request", ...options }),
      { plugin: true, release: true });
  }
  assert.equal(classifyChanges({ eventName: "pull_request", files: ["manifest.json"] }).release, false);
});

test("master pushes and manual dispatch always run the full plugin gate", () => {
  assert.deepEqual(classifyChanges({ eventName: "push", files: ["landing/README.md"] }),
    { plugin: true, release: false });
  assert.deepEqual(classifyChanges({ eventName: "workflow_dispatch", files: [] }),
    { plugin: true, release: true });
  assert.equal(classifyChanges({ eventName: "pull_request", files: [] }).plugin, true);
});

test("invalid or unknown scope input cannot bypass verification", () => {
  for (const input of [
    { eventName: "unknown", files: [] },
    { eventName: "pull_request", files: null },
    { eventName: "pull_request", files: ["../landing/x"] },
    { eventName: "pull_request", files: ["/landing/x"] },
    { eventName: "pull_request", files: ["landing/../src/main.ts"] },
    { eventName: "pull_request", files: ["landing\\x"] },
    { eventName: "pull_request", files: [""] },
    { eventName: "pull_request", files: [], versionChanged: "false" },
  ]) assert.throws(() => classifyChanges(input));
});

test("certification requires successful classification and all applicable proofs", () => {
  const success = { scopeResult: "success", releaseNeeded: "true",
    policy: "success", artifacts: "success", windows: "success" };
  assert.doesNotThrow(() => assertReleaseCertification(success));
  for (const key of ["scopeResult", "policy", "artifacts", "windows"]) {
    for (const result of ["failure", "cancelled", "skipped", undefined]) {
      assert.throws(() => assertReleaseCertification({ ...success, [key]: result }));
    }
  }
  assert.throws(() => assertReleaseCertification({ ...success, releaseNeeded: "" }));
});

test("non-release PRs explicitly require a valid scope and skipped heavy jobs", () => {
  const routine = { scopeResult: "success", releaseNeeded: "false",
    policy: "skipped", artifacts: "skipped", windows: "skipped" };
  assert.doesNotThrow(() => assertReleaseCertification(routine));
  assert.throws(() => assertReleaseCertification({ ...routine, scopeResult: "failure" }));
  assert.throws(() => assertReleaseCertification({ ...routine, artifacts: "failure" }));
});

test("scope CLI reads real Git revisions, renames and version changes, and rejects missing commits", (t) => {
  const script = resolve("scripts/ci/change-scope.mjs");
  const root = mkdtempSync(join(tmpdir(), "nox-ci-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", [
    "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false",
    "-c", `core.hooksPath=${join(root, ".git", "hooks")}`, ...args,
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init");
  git("config", "user.name", "Nox fixture");
  git("config", "user.email", "fixture@example.invalid");
  mkdirSync(join(root, "landing"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "manifest.json"), '{"version":"1.3.2"}\n');
  writeFileSync(join(root, "src", "main.ts"), "export const plugin = true;\n");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  const output = join(root, "scope-output");
  const run = (head: string) => {
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", HEAD_REF: "feature/fixture",
        BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output } });
    return { ...result, output: readFileSync(output, "utf8") };
  };
  writeFileSync(join(root, "landing", "note with spaces.md"), "landing\n");
  git("add", ".");
  git("commit", "-m", "landing");
  const landing = run(git("rev-parse", "HEAD"));
  assert.equal(landing.status, 0, landing.stderr);
  assert.equal(landing.output, "plugin=false\nrelease=false\n");
  renameSync(join(root, "src", "main.ts"), join(root, "landing", "main.ts"));
  git("add", "src", "landing");
  git("commit", "-m", "move plugin into landing");
  const moved = run(git("rev-parse", "HEAD"));
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(moved.output, "plugin=true\nrelease=false\n");
  writeFileSync(join(root, "manifest.json"), '{"version":"1.3.3"}\n');
  git("add", "manifest.json");
  git("commit", "-m", "version bump on an ordinary branch");
  const version = run(git("rev-parse", "HEAD"));
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.output, "plugin=true\nrelease=true\n");
  const missing = run("f".repeat(40));
  assert.notEqual(missing.status, 0);
  assert.equal(missing.output, "");
});
