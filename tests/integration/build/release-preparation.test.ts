import test from "node:test";
import assert from "node:assert/strict";
import { parseVersion, nextVersion, releaseEntry, prependChangelog } from "../../../scripts/prepare-release.mjs";

test("Obsidian releases require exact x.y.z semver tags", () => {
  assert.deepEqual(parseVersion("0.1.0"), [0, 1, 0]);
  for (const invalid of ["v0.1.0", "0.1", "0.1.0-beta.1", "01.2.3", ""]) {
    assert.throws(() => parseVersion(invalid));
  }
});

test("release bumps preserve SemVer and bootstrap first release", () => {
  assert.equal(nextVersion("0.1.0", "current"), "0.1.0");
  assert.equal(nextVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(nextVersion("0.1.0", "minor"), "0.2.0");
  assert.equal(nextVersion("0.1.0", "major"), "1.0.0");
  assert.throws(() => nextVersion("0.1.0", "prerelease"));
});

test("conventional commit subjects generate concise grouped notes", () => {
  const entry = releaseEntry("0.2.0", [
    "feat(chat): support learning map",
    "fix: prevent duplicate note edits",
    "docs: explain provider permissions",
    "some non-conventional internal commit",
  ]);
  assert.match(entry, /### Features/);
  assert.match(entry, /### Fixes/);
  assert.match(entry, /### Documentation/);
  assert.doesNotMatch(entry, /non-conventional/);
});

test("first release notes and duplicate changelog are guarded", () => {
  const initial = releaseEntry("0.1.0", [], true);
  const output = prependChangelog("# Changelog\n\n", initial, "0.1.0");
  assert.match(output, /## \[0\.1\.0\]/);
  assert.throws(() => prependChangelog(output, initial, "0.1.0"));
});

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

test("release preparation creates matching metadata, rejects duplicate, then bumps safely", () => {
  const directory = mkdtempSync(join(tmpdir(), "nox-release-"));
  const script = resolve("scripts/prepare-release.mjs");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "ignore" });
  const version = () => JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")).version;
  const run = (bump: string) => spawnSync(process.execPath, [script, bump], { cwd: directory, encoding: "utf8" });
  try {
    git("init");
    git("config", "user.email", "nox-test@example.invalid");
    git("config", "user.name", "Nox Test");
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ id: "nox", version: "0.1.0" }));
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "0.1.0" }));
    writeFileSync(join(directory, "CHANGELOG.md"), "# Changelog\n\n");
    git("add", ".");
    git("commit", "-m", "feat: initial plugin");
    assert.equal(run("current").status, 0);
    assert.equal(version(), "0.1.0");
    assert.match(readFileSync(join(directory, "CHANGELOG.md"), "utf8"), /## \[0\.1\.0\]/);
    assert.notEqual(run("current").status, 0, "same version cannot be prepared twice");
    git("add", ".");
    git("commit", "-m", "chore(release): prepare 0.1.0");
    git("tag", "0.1.0");
    assert.equal(run("patch").status, 0);
    assert.equal(version(), "0.1.1");
    assert.equal(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version, "0.1.1");
    assert.match(readFileSync(join(directory, "CHANGELOG.md"), "utf8"), /## \[0\.1\.1\]/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
