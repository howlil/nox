import { readdirSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractImports } from "./architecture-graph.mjs";

const root = process.cwd();
const canonicalRoot = "packages/core/src";
const legacyRoot = "src";
function walk(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const filename = directory + "/" + entry.name;
    return entry.isDirectory() ? walk(filename) : filename.endsWith(".ts") ? [filename] : [];
  }).sort();
}

/** Guard all physically extracted core modules, not just domain. */
export function checkPhysicalDomain() {
  const files = walk(canonicalRoot).filter(path => path !== canonicalRoot + "/index.ts");
  const present = new Set(files);
  const issues = [];
  const domains = files.filter(path => path.startsWith(canonicalRoot + "/domain/"));
  if (domains.length !== 31) issues.push("Expected 31 original canonical domain modules");

  for (const canonical of files) {
    const suffix = canonical.slice(canonicalRoot.length + 1);
    const old = legacyRoot + "/" + suffix;
    const legacy = readFileSync(resolve(root, old), "utf8");
    const oldDir = posix.dirname(old);
    const target = canonical.slice(0, -3);
    const relative = posix.relative(oldDir, target);
    const specifier = relative.startsWith(".") ? relative : "./" + relative;
    const expected = 'export * from "' + specifier + '";\n';
    if (legacy !== expected) issues.push(old + ": duplicate logic, invalid shim or missing compatibility module");

    const source = readFileSync(resolve(root, canonical), "utf8");
    const parsed = extractImports(canonical, source);
    for (const dynamic of parsed.dynamic) issues.push(canonical + ": nonliteral dynamic dependency");
    for (const { specifier: spec } of parsed.imports) {
      if (!spec.startsWith(".")) {
        issues.push(canonical + ": package core imports runtime/external module " + spec);
      } else {
        const base = posix.normalize(posix.join(posix.dirname(canonical), spec));
        if (!present.has(base + ".ts") && !present.has(base + "/index.ts")) {
          issues.push(canonical + ": dependency escapes canonical core: " + spec);
        }
      }
    }
  }
  const entry = readFileSync(resolve(root, canonicalRoot + "/index.ts"), "utf8");
  const entryImports = extractImports(canonicalRoot + "/index.ts", entry);
  for (const { specifier: spec } of entryImports.imports) {
    const target = posix.normalize(posix.join(canonicalRoot, spec));
    if (!spec.startsWith("./") || !present.has(target + ".ts")) {
      issues.push("Core public entry must export only package-owned source: " + spec);
    }
  }
  return issues;
}
const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const issues = checkPhysicalDomain();
  if (issues.length) { console.error(issues.join("\n")); process.exitCode = 1; }
  else console.log("M10.2 physical core source ownership verified");
}
