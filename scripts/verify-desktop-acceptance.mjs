import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const expectedCases = Array.from({ length: 10 }, (_, i) => "D" + String(i + 1).padStart(2, "0"));
const commitId = /^[a-f0-9]{40}$/;
const evidenceLink = /^https:\/\/(github\.com|github\.usercontent\.com|objects\.githubusercontent\.com)\//i;

/** Human desktop proof is an input, not something simulated by mock tests. */
export function checkDesktopAcceptance(evidence, { version, isAncestor, changesSince } = {}) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("Invalid desktop acceptance record.");
  if (evidence.version !== version) throw new Error("Desktop acceptance version does not match manifest.");
  if (typeof evidence.testedCommit !== "string" || !commitId.test(evidence.testedCommit)) {
    throw new Error("Desktop acceptance requires a full 40-character tested commit.");
  }
  if (!["win32", "darwin", "linux"].includes(evidence.platform) ||
      typeof evidence.obsidianVersion !== "string" ||
      !/^\d+\.\d+\.\d+/.test(evidence.obsidianVersion) ||
      typeof evidence.reviewer !== "string" || !evidence.reviewer.trim() ||
      typeof evidence.testedAt !== "string" ||
      Number.isNaN(Date.parse(evidence.testedAt))) {
    throw new Error("Desktop acceptance requires real platform, Obsidian version, reviewer and date.");
  }
  if (!Array.isArray(evidence.cases) || evidence.cases.length !== expectedCases.length) {
    throw new Error("Desktop acceptance must include D01-D10.");
  }
  const results = new Map();
  for (const item of evidence.cases) {
    if (!item || !expectedCases.includes(item.id) || results.has(item.id) ||
        item.status !== "PASS" || typeof item.evidenceUrl !== "string" ||
        !evidenceLink.test(item.evidenceUrl)) {
      throw new Error("Desktop acceptance has missing, duplicated, failed or unlinked cases.");
    }
    results.set(item.id, item);
  }
  if (expectedCases.some(id => !results.has(id))) throw new Error("Desktop acceptance has incomplete cases.");
  if (typeof isAncestor === "function" && !isAncestor(evidence.testedCommit)) {
    throw new Error("Desktop-tested commit is not an ancestor of the publication source.");
  }
  if (typeof changesSince === "function" && changesSince(evidence.testedCommit)) {
    throw new Error("Runtime or release-critical code changed since desktop acceptance.");
  }
  return { version, testedCommit: evidence.testedCommit, caseCount: results.size };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: "pipe" }).trim();
}

export function verifyDesktopAcceptanceFile(filename = "docs/desktop-acceptance.json") {
  if (!existsSync(filename)) {
    throw new Error("Native Obsidian desktop acceptance is NOT RUN. Record D01-D10 before publishing.");
  }
  const version = JSON.parse(readFileSync("manifest.json", "utf8")).version;
  const evidence = JSON.parse(readFileSync(filename, "utf8"));
  return checkDesktopAcceptance(evidence, {
    version,
    isAncestor: sha => {
      try { git("merge-base", "--is-ancestor", sha, "HEAD"); return true; } catch { return false; }
    },
    changesSince: sha => {
      try {
        // Release-only metadata may change after acceptance. Any runtime, test,
        // security or publication logic change invalidates the prior desktop proof.
        git("diff", "--quiet", sha, "HEAD", "--",
          "src", "styles.css", "scripts", "tests", ".github/workflows", "esbuild.config.mjs");
        return false;
      } catch { return true; }
    },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyDesktopAcceptanceFile();
    console.log("Native Obsidian acceptance verified:", result.version, result.caseCount + " cases.");
  } catch (error) {
    console.error("::error::" + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
