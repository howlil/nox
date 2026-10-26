import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { extractImports } from "./architecture-graph.mjs";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = dir + "/" + entry.name;
    return entry.isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Consumers must not resolve back through src/ compatibility shims.
 * Use AST imports (including import types and re-exports), not string scanning. */
// Incrementally migrated adapters consume a curated first-party package API,
// never private package source or compiled artifacts by deep import.
const PUBLIC_API_ADAPTERS = new Set([
  "src/context/ObsidianContext.ts",
  "src/context/PolicyLoader.ts",
  // M11.2: provider transports, durable Obsidian stores, and lifecycle adapter.
  "src/agent/ChatGptAdapter.ts",
  "src/agent/CodexAdapter.ts",
  "src/agent/AgyAdapter.ts",
  "src/persistence/VaultLearningStore.ts",
  "src/persistence/VaultProgramStore.ts",
  "src/persistence/PluginDataRepository.ts",
  "src/persistence/OnboardingStateRepository.ts",
  "src/host/obsidian/lifecycle.ts",
]);

export function validateHostConsumption(files, canonicalPaths) {
  const canonical = new Set(canonicalPaths);
  const issues = [];
  for (const { path, source } of files) {
    // The legacy compatibility facades themselves are deliberately retained
    // until all external/test imports can be retired in the next milestone.
    if (path.startsWith("src/") && canonical.has("packages/core/" + path)) continue;
    for (const importInfo of extractImports(path, source).imports) {
      const spec = importInfo.specifier;
      const absolute = spec.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(path), spec)) : spec;
      if (PUBLIC_API_ADAPTERS.has(path) &&
          (absolute.startsWith("packages/core/") || spec.startsWith("@nox/core/"))) {
        issues.push(path + ":" + importInfo.line +
          ": adapter must use the @nox/core public API, not " + spec);
      }
      if (!spec.startsWith(".")) continue;
      const candidates = [absolute, absolute + ".ts", absolute + "/index.ts"];
      for (const candidate of candidates) {
        if (candidate.startsWith("src/") && canonical.has("packages/core/" + candidate)) {
          issues.push(path + ":" + importInfo.line +
            ": production code imports legacy core shim " + candidate);
          break;
        }
      }
    }
  }
  return issues;
}

export function checkHostConsumption() {
  const production = [...walk("src"), ...walk("headless/src"), ...walk("browser/src")]
    .map(path => ({ path, source: readFileSync(path, "utf8") }));
  const canonical = walk("packages/core/src");
  return validateHostConsumption(production, canonical);
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const issues = checkHostConsumption();
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else console.log("M10.3: production consumers bypass every legacy core source shim");
}
