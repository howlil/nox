import { readdirSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const canonicalRoot = "packages/core/src/domain";
const legacyRoot = "src/domain";
function walk(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = directory + "/" + entry.name;
    return entry.isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  }).sort();
}
/** Fail closed on duplicate domain implementation, a missing shim, or an outward runtime edge. */
export function checkPhysicalDomain() {
  const canonical = walk(canonicalRoot);
  const legacy = walk(legacyRoot);
  const issues = [];
  if (!canonical.length || canonical.length !== legacy.length) {
    issues.push("Domain file count mismatch between canonical package and legacy paths");
  }
  const present = new Set(canonical);
  for (const oldPath of legacy) {
    const suffix = oldPath.slice(legacyRoot.length + 1);
    const target = canonicalRoot + "/" + suffix;
    if (!present.has(target)) issues.push(oldPath + ": missing canonical implementation");
    const expected = 'export * from "../../../packages/core/src/domain/' + suffix.slice(0, -3) + '";\n';
    if (readFileSync(resolve(root, oldPath), "utf8") !== expected) {
      issues.push(oldPath + ": legacy module must be an exact compatibility export");
    }
  }
  for (const path of canonical) {
    const content = readFileSync(resolve(root, path), "utf8");
    for (const match of content.matchAll(/\b(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)(["'])([^"']+)\1/g)) {
      const specifier = match[2];
      if (!specifier.startsWith(".")) {
        issues.push(path + ": domain cannot import runtime/external module " + specifier);
      } else {
        const target = posix.normalize(posix.join(posix.dirname(path), specifier));
        if (!present.has(target + ".ts") && !present.has(target + "/index.ts")) {
          issues.push(path + ": dependency escapes canonical domain: " + specifier);
        }
      }
    }
  }
  return issues;
}
const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const issues = checkPhysicalDomain();
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else console.log("M10.1 domain source ownership verified: 31 canonical modules");
}
