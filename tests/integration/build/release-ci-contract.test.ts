import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("development CI keeps platform and scanner jobs off ordinary PRs", () => {
  const dev = read(".github/workflows/ci.yml");
  assert.match(dev, /run: pnpm ci:critical/);
  assert.doesNotMatch(dev, /^  windows-dpapi:/m);
  assert.doesNotMatch(dev, /^  community-readiness:/m);
  assert.doesNotMatch(dev, /Reproducible production build/);
});

test("release candidate certification requires policy, Windows and reproducible artifacts", () => {
  const release = read(".github/workflows/ci-release.yml");
  assert.match(release, /name: release-certified/);
  assert.match(release, /needs: \[policy, artifacts, windows-dpapi\]/);
  assert.match(release, /test "\$POLICY" = success/);
  assert.match(release, /test "\$ARTIFACTS" = success/);
  assert.match(release, /test "\$WINDOWS" = success/);
  assert.match(release, /Reproducible|deterministic production bundle/);
});

test("the release-plan merge only creates a draft, while publication is explicit", () => {
  const draft = read(".github/workflows/release.yml");
  const publish = read(".github/workflows/publish-release.yml");
  assert.match(draft, /--draft/);
  assert.doesNotMatch(draft, /^\s*gh release edit .*--draft=false/m);
  assert.match(publish, /^\s*workflow_dispatch:/m);
  assert.match(publish, /desktop_acceptance/);
  assert.match(publish, /expected_sha/);
  assert.match(publish, /environment: public-release/);
  assert.match(publish, /gh attestation verify/);
  assert.match(publish, /^\s*gh release edit "\$VERSION" --draft=false/m);
});
