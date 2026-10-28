import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { extractImports } from "./architecture-graph.mjs";

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = directory + "/" + entry.name;
    return entry.isDirectory() ? walk(path) :
      /\.(ts|tsx|mjs|cjs|js)$/.test(path) ? [path] : [];
  });
}

/** M13 waves 1–3: deleted facades must never be recreated even if a caller appears. */
export const RETIRED_CORE_SHIMS = new Set([
  "src/domain/learner-model/activity-policy.ts",
  "src/domain/learner-model/feedback-policy.ts",
  "src/domain/learner-model/learner-profile.ts",
  "src/domain/activity/aggregation.ts",
  "src/domain/workspace/plan.ts",
  "src/domain/mutation/replacement.ts",
  "src/application/research-scope.ts",
  "src/domain/learning-program/assessment-rubric.ts",
  "src/application/PracticeSessionRegistry.ts",
  "src/application/action-builders.ts",
  "src/domain/learning-program/session-time.ts",
  "src/features/learning/program/ProgramMutationQueue.ts",
  "src/domain/usage/usage-accounting.ts",
  "src/domain/learning-program/estimate.ts",
  "src/domain/learning-state/gap-projection.ts",
  "src/domain/learning-program/curriculum-revision-schema.ts",
  "src/application/LearningContextOrchestrator.ts",
  "src/features/learning/program/ProgramReadModel.ts",
  "src/features/conversation/turn/turn-output-error.ts",
]);

/** Conservatively catalog static imports into the old compatibility facade.
 * Test references and architecture manifest contracts justify keeping a shim. */
export function auditLegacyCoreShims() {
  const canonical = new Set(walk("packages/core/src").filter(p => p.endsWith(".ts")));
  const old = [...canonical].filter(p => p !== "packages/core/src/index.ts")
    .map(p => "src/" + p.slice("packages/core/src/".length));
  const consumers = new Map(old.map(p => [p, new Set()]));
  const callers = ["src", "tests", "headless/src", "browser/src", "scripts"]
    .flatMap(walk);
  for (const path of callers) {
    if (consumers.has(path)) continue;
    const parsed = extractImports(path, readFileSync(path, "utf8"));
    for (const item of parsed.imports) {
      if (!item.specifier.startsWith(".")) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), item.specifier));
      for (const candidate of [target, target + ".ts", target + "/index.ts"]) {
        if (consumers.has(candidate)) consumers.get(candidate).add(path);
      }
    }
  }
  // These files remain declared portability contracts in the M0 test suite.
  const contracts = readFileSync("scripts/portable-boundaries.mjs", "utf8");
  for (const shim of old) {
    if (contracts.includes('"' + shim + '"')) consumers.get(shim).add("portable-contract-manifest");
  }
  const retained = old.filter(p => consumers.get(p).size > 0);
  const unused = old.filter(p => consumers.get(p).size === 0 && existsSync(p));
  const missingReferenced = retained.filter(p => !existsSync(p));
  return {
    retained, unused, missingReferenced,
    reintroduced: old.filter(p => RETIRED_CORE_SHIMS.has(p) && existsSync(p)),
    evidence: Object.fromEntries(retained.map(p => [p, [...consumers.get(p)].sort()])),
  };
}
if (process.argv[1]?.endsWith("/check-core-shims.mjs")) {
  const result = auditLegacyCoreShims();
  console.log("M10.4 shim inventory:", JSON.stringify({
    retained: result.retained.length, unused: result.unused, missingReferenced: result.missingReferenced,
  }));
  if (result.missingReferenced.length || result.reintroduced.length) process.exitCode = 1;
}
