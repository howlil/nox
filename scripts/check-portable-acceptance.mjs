import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { verifyDesktopAcceptanceFile } from "./verify-desktop-acceptance.mjs";

/** Automated contracts never substitute for actual native desktop evidence. */
export function portableAcceptanceIssues({ ci, release, recovery, core, tsconfig, source }) {
  const issues = [];
  const ciGates = [
    "pnpm install --frozen-lockfile", "pnpm check:boundaries",
    "pnpm typecheck", "pnpm lint", "pnpm test:unit",
    "pnpm test:integration", "pnpm core:verify", "pnpm core:hosts",
    "pnpm browser:verify", "pnpm build", "pnpm test:artifacts",
  ];
  for (const name of ciGates) {
    if (!ci.includes(name)) issues.push("Missing portable CI gate: " + name);
  }
  for (const name of ["desktop-acceptance:", "node scripts/verify-desktop-acceptance.mjs",
    "desktop-acceptance]"]) {
    if (!release.includes(name)) issues.push("Native desktop publication gate missing: " + name);
  }
  if (!recovery.includes("node scripts/verify-desktop-acceptance.mjs")) {
    issues.push("Recovery publication must verify native desktop evidence");
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
  for (const name of ["LearningController", "SessionController", "SessionStore", "AgentRuntime"]) {
    if (!source.includes("export { " + name + " }")) {
      issues.push("@nox/core public API missing: " + name);
    }
  }
  return issues;
}

/**
 * CI configuration is NOT evidence that the workflow passed on this SHA.
 * The preflight runs before the build job finishes; only a separate,
 * externally verified same-head CI result may satisfy ciRunVerified.
 */
export function summarizePortableAcceptance({ issues, nativeStatus, ciRunVerified = false }) {
  const blockers = [...issues];
  if (nativeStatus !== "PASS") {
    blockers.push("Native Obsidian desktop D01-D10 acceptance is NOT RUN or unverified.");
  }
  if (!ciRunVerified) {
    blockers.push("Same-head complete CI result must be verified independently.");
  }
  return { automated: issues.length ? "FAIL" : "PASS", native: nativeStatus,
    ciVerified: ciRunVerified, mergeReady: blockers.length === 0, blockers };
}

export function checkPortableAcceptance(root = process.cwd()) {
  const read = path => readFileSync(resolve(root, path), "utf8");
  const issues = portableAcceptanceIssues({
    ci: read(".github/workflows/ci.yml"),
    release: read(".github/workflows/release.yml"),
    recovery: read(".github/workflows/publish-release.yml"),
    core: JSON.parse(read("packages/core/package.json")),
    tsconfig: JSON.parse(read("tsconfig.json")),
    source: read("packages/core/src/index.ts"),
  });
  let nativeStatus = "NOT RUN";
  const nativeFile = resolve(root, "docs/desktop-acceptance.json");
  if (existsSync(nativeFile)) {
    verifyDesktopAcceptanceFile(nativeFile);
    nativeStatus = "PASS";
  }
  const report = summarizePortableAcceptance({ issues, nativeStatus });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      "\n## M7 Portable NOX acceptance",
      "- Automated contract: **" + report.automated + "**",
      "- Native Obsidian desktop: **" + report.native + "**",
      "- Merge-ready: **" + (report.mergeReady ? "YES" : "NO") + "**",
      "- Blockers: " + report.blockers.join("; "), "",
    ].join("\n"));
  }
  if (issues.length) throw new Error(issues.join("\n"));
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPortableAcceptance();
}
