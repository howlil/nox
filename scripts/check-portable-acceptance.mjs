import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * Automated preflight for NOX portable core and release provenance contracts.
 * This validates configuration only; a passing check does NOT replace the
 * completed GitHub CI run or the release-candidate certification workflow.
 */
export function portableAcceptanceIssues({ ci, release, recovery, core, tsconfig, source }) {
  const issues = [];
  const ciGates = [
    "pnpm install --frozen-lockfile", "pnpm check:boundaries",
    "pnpm typecheck", "pnpm lint", "pnpm test:unit",
    "pnpm test:integration", "pnpm core:verify", "pnpm core:hosts",
    "pnpm browser:verify", "pnpm build", "pnpm test:artifacts",
    "pnpm acceptance:runtime",
  ];
  for (const name of ciGates) {
    if (!ci.includes(name)) issues.push("Missing portable CI gate: " + name);
  }
  if (!release.includes("needs: [detect, linux, windows, community]")) {
    issues.push("Publication must depend on Linux, Windows, and Community certification");
  }
  for (const token of ["gh attestation verify", "Source ref moved", "remote asset allowlist"]) {
    if (!release.includes(token)) issues.push("Publication provenance check missing: " + token);
  }
  for (const token of ["gh attestation verify", "node scripts/check-release.mjs",
    "EXPECTED_SHA"]) {
    if (!recovery.includes(token)) issues.push("Recovery provenance check missing: " + token);
  }
  if (core.name !== "@nox/core" || core.private !== true ||
    core.exports?.["."]?.import !== "./dist/index.mjs" ||
    core.exports?.["."]?.require !== "./dist/index.cjs" ||
    typeof core.exports?.["."]?.types !== "string") {
    issues.push("@nox/core must remain private with ESM/CJS and types");
  }
  if (tsconfig.compilerOptions?.paths?.["@nox/core"]?.[0] !== "packages/core/src/index.ts") {
    issues.push("Hosts must resolve @nox/core through its canonical source-alias");
  }
  // Preflight checks only declared named exports, not release/runtime validity.
  // Keep this lightweight: importing the TypeScript compiler here would bundle
  // its Node-only internals into isolated integration-test ESM runners.
  const declarations = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const exported = new Set([...declarations.matchAll(
    /^\s*export\s+(?:type\s+)?\{([^}]+)\}/gm,
  )].flatMap(([, bindings]) => bindings.split(",")
    .map(name => name.trim().split(/\s+as\s+/).at(-1))
    .filter(Boolean)));
  for (const name of ["LearningController", "SessionController", "SessionStore", "AgentRuntime"]) {
    if (!exported.has(name)) issues.push("@nox/core public API missing: " + name);
  }
  return issues;
}

/** Preflight reports structural policy only, never a fabricated overall CI result. */
export function summarizePortableAcceptance({ issues }) {
  return { configuration: issues.length ? "FAIL" : "PASS",
    blockers: issues, completedCiVerified: false };
}

export function checkPortableAcceptance(root = process.cwd()) {
  const read = file => readFileSync(resolve(root, file), "utf8");
  const issues = portableAcceptanceIssues({
    ci: read(".github/workflows/ci.yml"),
    release: read(".github/workflows/release.yml"),
    recovery: read(".github/workflows/publish-release.yml"),
    core: JSON.parse(read("packages/core/package.json")),
    tsconfig: JSON.parse(read("tsconfig.json")),
    source: read("packages/core/src/index.ts"),
  });
  const report = summarizePortableAcceptance({ issues });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      "\n## Portable NOX automated preflight\n" +
      "- Configuration: **" + report.configuration + "**\n" +
      "- Complete same-head CI: must be checked independently\n" +
      "- Issues: " + (issues.join("; ") || "none") + "\n");
  }
  if (issues.length) throw new Error(issues.join("\n"));
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPortableAcceptance();
}
