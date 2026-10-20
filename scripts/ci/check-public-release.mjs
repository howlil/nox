import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_ASSETS = ["main.js", "manifest.json", "styles.css"];
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Obsidian Community Directory reads master/manifest.json, not staged PRs. */
export function assertPublishedManifestParity(manifest, release) {
  if (!manifest || manifest.id !== "nox" ||
      typeof manifest.version !== "string" ||
      !VERSION_PATTERN.test(manifest.version)) {
    throw new Error("Invalid Obsidian manifest identity or release version.");
  }
  const version = manifest.version;
  if (!release || release.tag_name !== version || release.draft !== false ||
      release.prerelease === true || !release.published_at) {
    throw new Error("NOX_RELEASE_NOT_PUBLISHED: master manifest version " + version +
      " must have a public, non-prerelease GitHub Release tagged exactly " + version +
      " (no v prefix). Publish from the release branch BEFORE merging version metadata.");
  }
  const names = release.assets?.map(asset => asset.name) ?? [];
  const actual = [...names].sort();
  const expected = [...REQUIRED_ASSETS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected) ||
      release.assets.some(asset => !(asset.size > 0) || asset.state && asset.state !== "uploaded")) {
    throw new Error("NOX_RELEASE_ASSETS_INCOMPLETE: published " + version +
      " must contain exactly nonempty main.js, manifest.json, styles.css.");
  }
  return { version, url: release.html_url };
}

export async function checkPublishedManifest({ fetchImpl = fetch, env = process.env } = {}) {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const repository = env.GITHUB_REPOSITORY || "howlil/nox";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("Invalid GITHUB_REPOSITORY.");
  }
  const response = await fetchImpl(
    "https://api.github.com/repos/" + repository + "/releases/tags/" + encodeURIComponent(manifest.version),
    { headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "nox-obsidian-public-release-parity",
      ...(env.GITHUB_TOKEN ? { Authorization: "Bearer " + env.GITHUB_TOKEN } : {}),
    }},
  );
  if (response.status === 404) {
    throw new Error("NOX_RELEASE_NOT_PUBLISHED: manifest.json points to " + manifest.version +
      " but GitHub has no public release tagged exactly " + manifest.version +
      ". Restore the last published version on master; keep the new version on a release branch.");
  }
  if (!response.ok) {
    throw new Error("Cannot verify GitHub public release (HTTP " + response.status + "); fail closed.");
  }
  return assertPublishedManifestParity(manifest, await response.json());
}

if (process.argv[1] && basename(process.argv[1]) === "check-public-release.mjs" &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkPublishedManifest();
    console.log("Obsidian Community release parity verified:", result.version, result.url);
  } catch (error) {
    console.error("::error::" + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
