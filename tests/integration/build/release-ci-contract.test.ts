import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");

test("plugin CI has no Cloudflare or landing jobs", () => {
  const dev = read(".github/workflows/ci.yml");
  assert.doesNotMatch(dev, /paths-ignore:/);
  assert.match(dev, /run: node scripts\/ci\/change-scope\.mjs/);
  assert.match(dev, /if: always\(\)\s+needs: changes/);
  assert.match(dev, /PLUGIN_NEEDED: \$\{\{ needs\.changes\.outputs\.plugin \}\}/);
  assert.match(dev, /run: pnpm ci:critical/);
  assert.match(dev, /run: pnpm lint/);
  assert.doesNotMatch(dev, /run: pnpm lint:typed/);
  assert.match(dev, /node scripts\/ci\/check-public-release\.mjs/);
  // Public parity runs independently so certification can finish while an
  // unpublished candidate is correctly blocked from merging.
  const parity = dev.slice(dev.indexOf("  public-release-parity:"));
  assert.match(parity, /run: node scripts\/ci\/check-public-release\.mjs/);
  assert.doesNotMatch(parity, /if:/);
  assert.doesNotMatch(dev, /startsWith\(github\.head_ref, 'release\/'\)/);
  assert.match(dev, /github\.event_name == 'pull_request'/);
  assert.doesNotMatch(dev, /^  landing:/m);
  assert.doesNotMatch(dev, /npm run build/);
  assert.doesNotMatch(dev, /^  windows-dpapi:/m);
});

test("release certification is strict and requires Windows plus reproducible artifacts", () => {
  const release = read(".github/workflows/ci-release.yml");
  assert.match(release, /name: release-certified/);
  assert.doesNotMatch(release, /^    paths:/m);
  assert.match(release, /needs: \[changes, policy, artifacts, windows-dpapi\]/);
  assert.match(release, /SCOPE_RESULT: \$\{\{ needs\.changes\.result \}\}/);
  assert.match(release, /RELEASE_NEEDED: \$\{\{ needs\.changes\.outputs\.release \}\}/);
  assert.match(release, /run: node scripts\/ci\/change-scope\.mjs certify/);
  assert.equal((release.match(/if: needs\.changes\.outputs\.release == 'true'/g) ?? []).length, 3);
  assert.match(release, /lint: "true"/);
  assert.match(release, /scanner-lint: "true"/);
  assert.match(release, /strict: "false"/);
  assert.match(release, /pnpm ci:critical/);
  assert.match(release, /      - run: pnpm verify/);
  assert.doesNotMatch(release, /pnpm lint:typed/);
  assert.doesNotMatch(release, /pnpm ci:critical && pnpm verify/);
  assert.match(release, /Reproducible|deterministic production bundle/);
  assert.match(release, /NodeInferenceTransport\.test\.ts/);
});

test("auto-publication requires strict source-bound attestations on the exact downloaded assets", () => {
  const release = read(".github/workflows/release.yml");
  const recovery = read(".github/workflows/publish-release.yml");
  assert.match(release, /needs: \[detect, linux, windows, community\]/);
  assert.match(release, /pnpm ci:critical && pnpm verify/);
  assert.doesNotMatch(release, /pnpm lint:typed/);
  assert.match(release, /lint: "true"/);
  assert.match(release, /Detect unshipped release by ID rather than public tag/);
  assert.match(release, /contents: write/);
  assert.match(release, /\.tag_name == \$v or \.name ==/);
  assert.match(release, /-f tag_name="\$version"/);
  assert.match(release, /Published tag or source SHA mismatch/);
  assert.match(release, /--target "\$GITHUB_SHA"/);
  assert.match(release, /actual_digest/);
  assert.match(release, /expected_digest/);
  assert.match(release, /gh attestation verify "dist\/\$file".*--source-digest "\$GITHUB_SHA"/);
  assert.ok(release.indexOf("Publish only source-bound assets by release ID") <
    release.indexOf("gh api -X PATCH -F draft=false"));
  assert.match(release, /gh api -X PATCH -F draft=false/);
  assert.match(release, /"release\/\$version"/);
  assert.match(release, /Source ref moved/);
  assert.match(recovery, /expected_sha/);
  assert.match(recovery, /gh attestation verify/);
});
