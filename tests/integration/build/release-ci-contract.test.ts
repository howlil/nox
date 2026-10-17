import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("plugin CI has no Cloudflare or landing jobs", () => {
  const dev = read(".github/workflows/ci.yml");
  assert.match(dev, /paths-ignore: \['landing\/\*\*'\]/);
  assert.match(dev, /run: pnpm ci:critical/);
  assert.doesNotMatch(dev, /^  landing:/m);
  assert.doesNotMatch(dev, /npm run build/);
  assert.doesNotMatch(dev, /^  windows-dpapi:/m);
});

test("release certification is strict and requires Windows plus reproducible artifacts", () => {
  const release = read(".github/workflows/ci-release.yml");
  assert.match(release, /name: release-certified/);
  assert.match(release, /needs: \[policy, artifacts, windows-dpapi\]/);
  assert.match(release, /test "\$POLICY" = success/);
  assert.match(release, /test "\$ARTIFACTS" = success/);
  assert.match(release, /test "\$WINDOWS" = success/);
  assert.match(release, /strict: "true"/);
  assert.match(release, /Reproducible|deterministic production bundle/);
});

test("auto-publication requires strict source-bound attestations on the exact downloaded assets", () => {
  const release = read(".github/workflows/release.yml");
  const recovery = read(".github/workflows/publish-release.yml");
  assert.match(release, /needs: \[detect, linux, windows, community\]/);
  assert.match(release, /strict: "true"/);
  assert.match(release, /gh release upload "\$version".*--clobber/);
  assert.match(release, /--target "\$GITHUB_SHA"/);
  assert.match(release, /cmp "dist\/\$item" "release-proof\/\$item"/);
  assert.match(release, /gh attestation verify "release-proof\/\$item".*--source-digest "\$GITHUB_SHA"/);
  assert.ok(release.indexOf("Publish only verified source-bound release assets") <
    release.indexOf('gh release edit "$version" --draft=false'));
  assert.match(release, /gh release edit "\$version" --draft=false/);
  assert.doesNotMatch(release, /desktop_acceptance/);
  assert.match(recovery, /expected_sha/);
  assert.doesNotMatch(recovery, /desktop_acceptance/);
  assert.match(recovery, /gh attestation verify/);
});
