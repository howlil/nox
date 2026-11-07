import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_POLICY = new Set([
  ".release-plan.json",
  ".github/workflows/ci.yml",
  ".github/workflows/ci-release.yml",
  ".github/workflows/release.yml",
  ".github/workflows/publish-release.yml",
  ".github/workflows/prepare-release.yml",
  ".github/workflows/stage-release-draft.yml",
  "scripts/ci/change-scope.mjs",
  "scripts/ci/check-public-release.mjs",
  "scripts/check-release.mjs",
  "scripts/prepare-release.mjs",
  "scripts/select-release-bump.mjs",
]);

/** Routing is derived from the actual diff as well as the source branch. */
export function classifyChanges({ eventName, headRef = "", files, versionChanged = false }) {
  if (!["push", "pull_request", "workflow_dispatch"].includes(eventName) ||
      typeof headRef !== "string" || typeof versionChanged !== "boolean" ||
      !Array.isArray(files) || files.some(path => typeof path !== "string" ||
        path.includes("\\") || path.split("/").some(part => !part || part === "." || part === ".."))) {
    throw new Error("Cannot classify CI changes: invalid event or file list.");
  }
  return {
    plugin: eventName !== "pull_request" || files.length === 0 ||
      files.some(path => !path.startsWith("landing/")),
    release: eventName === "workflow_dispatch" || headRef.startsWith("release/") ||
      versionChanged || files.some(path => RELEASE_POLICY.has(path)),
  };
}

/** A failed classifier or an unexpectedly skipped proof never certifies a release. */
export function assertReleaseCertification({ scopeResult, releaseNeeded, policy, artifacts, windows }) {
  if (scopeResult !== "success" || !["true", "false"].includes(releaseNeeded)) {
    throw new Error("Release scope did not complete successfully.");
  }
  const expected = releaseNeeded === "true" ? "success" : "skipped";
  if ([policy, artifacts, windows].some(result => result !== expected)) {
    throw new Error("Release proof results do not match the validated scope.");
  }
}

function readScope(env) {
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    return classifyChanges({ eventName: env.GITHUB_EVENT_NAME, files: [] });
  }
  const { BASE_SHA: base, HEAD_SHA: head } = env;
  if (![base, head].every(sha => typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha)) ||
      /^0+$/.test(head)) throw new Error("CI requires explicit base and head commit SHAs.");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const initialPush = /^0+$/.test(base) && env.GITHUB_EVENT_NAME === "push";
  // No rename collapsing: moving a plugin file into landing must still count
  // as a plugin deletion. NUL separation preserves spaces and newlines in names.
  const paths = initialPush ? git("ls-files", "-z") :
    git("diff", "--name-only", "--no-renames", "-z", base, head, "--");
  const versionAt = sha => {
    const manifest = JSON.parse(git("show", sha + ":manifest.json"));
    if (typeof manifest.version !== "string") throw new Error("Invalid manifest version in CI scope.");
    return manifest.version;
  };
  return classifyChanges({ eventName: env.GITHUB_EVENT_NAME, headRef: env.HEAD_REF ?? "",
    files: paths.split("\0").filter(Boolean),
    versionChanged: initialPush || versionAt(base) !== versionAt(head) });
}

const direct = process.argv[1] && basename(process.argv[1]) === "change-scope.mjs" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  try {
    if (process.argv[2] === "certify") {
      assertReleaseCertification({ scopeResult: process.env.SCOPE_RESULT,
        releaseNeeded: process.env.RELEASE_NEEDED, policy: process.env.POLICY,
        artifacts: process.env.ARTIFACTS, windows: process.env.WINDOWS });
      console.log(process.env.RELEASE_NEEDED === "true" ? "All three release proofs succeeded." :
        "Release certification is not required for this validated diff.");
    } else {
      const scope = readScope(process.env);
      if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GitHub output destination.");
      appendFileSync(process.env.GITHUB_OUTPUT, `plugin=${scope.plugin}\nrelease=${scope.release}\n`);
      console.log("CI scope:", JSON.stringify(scope));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "CI scope failed.");
    process.exitCode = 1;
  }
}
