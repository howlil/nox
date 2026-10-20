import assert from "node:assert/strict";
import test from "node:test";
import { assertPublishedManifestParity } from "../../../scripts/ci/check-public-release.mjs";

const manifest = { id: "nox", version: "1.3.1" };
const release = {
  tag_name: "1.3.1", draft: false, prerelease: false,
  published_at: "2026-10-20T10:00:00Z", html_url: "https://github.com/howlil/nox/releases/tag/1.3.1",
  assets: ["main.js", "manifest.json", "styles.css"].map(name => ({ name, size: 123, state: "uploaded" })),
};

test("rejects a changed master manifest if GitHub has no public release", () => {
  assert.throws(() => assertPublishedManifestParity(manifest, null), /NOX_RELEASE_NOT_PUBLISHED/);
  assert.throws(() => assertPublishedManifestParity(manifest, { ...release, tag_name: "v1.3.1" }), /no v prefix/);
  assert.throws(() => assertPublishedManifestParity(manifest, { ...release, draft: true }), /NOX_RELEASE_NOT_PUBLISHED/);
  assert.throws(() => assertPublishedManifestParity(manifest, { ...release, prerelease: true }), /NOX_RELEASE_NOT_PUBLISHED/);
});

test("refuses incomplete, empty or unexpected public assets", () => {
  assert.throws(() => assertPublishedManifestParity(manifest, { ...release, assets: release.assets.slice(1) }), /ASSETS_INCOMPLETE/);
  assert.throws(() => assertPublishedManifestParity(manifest, { ...release,
    assets: [...release.assets, { name: "secret.txt", size: 4, state: "uploaded" }] }), /ASSETS_INCOMPLETE/);
  assert.throws(() => assertPublishedManifestParity(manifest, { ...release,
    assets: release.assets.map(a => a.name === "main.js" ? { ...a, size: 0 } : a) }), /ASSETS_INCOMPLETE/);
});

test("accepts only exact public release and three installable assets", () => {
  assert.equal(assertPublishedManifestParity(manifest, release).version, "1.3.1");
});
