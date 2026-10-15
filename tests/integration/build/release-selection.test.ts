import test from "node:test";
import assert from "node:assert/strict";
import { inferReleaseBump, latestVersionTag, recommendRelease } from "../../../scripts/select-release-bump.mjs";

test("auto bumps follow conventional commits without releasing docs-only changes", () => {
  assert.equal(inferReleaseBump(["docs: improve README", "ci: update checks"]), "none");
  assert.equal(inferReleaseBump(["fix(auth): restore login", "docs: update"]), "patch");
  assert.equal(inferReleaseBump(["feat(practice): add quiz", "fix: guard null"]), "minor");
  assert.equal(inferReleaseBump(["feat!: change persisted schema"]), "major");
  assert.equal(inferReleaseBump(["feat: migration\n\nBREAKING CHANGE: moves user data"]), "major");
});

test("first public version is unchanged, later versions need published tags", () => {
  assert.equal(recommendRelease({ current: "0.1.0", tags: [], plannedVersion: null, messages: [] }), "current");
  assert.equal(recommendRelease({ current: "0.1.0", tags: [], plannedVersion: "0.1.0", messages: [] }), "none");
  assert.equal(recommendRelease({ current: "0.1.0", tags: ["0.1.0"], plannedVersion: "0.1.0", messages: ["feat: new card"] }), "minor");
  assert.equal(recommendRelease({ current: "0.1.0", tags: ["0.1.0"], plannedVersion: "0.1.0", messages: ["docs: text"] }), "none");
  assert.throws(() => recommendRelease({ current: "0.1.1", tags: ["0.1.0"], plannedVersion: null, messages: ["fix: x"] }));
});

test("tags use Obsidian's strict SemVer format and numeric ordering", () => {
  assert.equal(latestVersionTag(["v9.0.0", "0.9.0", "0.10.0", "1.0.0-beta", "1.0.0"]), "1.0.0");
});
