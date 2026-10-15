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
