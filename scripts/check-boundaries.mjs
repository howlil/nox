import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateArchitecture } from "./boundaries.mjs";
import { validatePortableBoundaries } from "./portable-boundaries.mjs";
import { checkPhysicalDomain } from "./check-physical-domain.mjs";
import { checkHostConsumption } from "./check-host-consumption.mjs";
import { auditLegacyCoreShims } from "./check-core-shims.mjs";

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const pathname = join(directory, entry.name);
    return entry.isDirectory() ? walk(pathname) : [pathname.replaceAll("\\", "/")];
  });
}
const files = [...walk("src"), ...walk("packages/core/src")]
  .filter((pathname) => pathname.endsWith(".ts"))
  .map((pathname) => ({ path: pathname, source: readFileSync(pathname, "utf8") }));
const legacy = walk("tests").filter((pathname) =>
  (pathname.startsWith("tests/ui/") ||
    (pathname.startsWith("tests/learning/") &&
      !pathname.startsWith("tests/integration/learning/"))));
const shimReport = auditLegacyCoreShims();
console.log("M10.4 legacy compatibility shims still referenced:", shimReport.retained.length);
console.log("M10.4 unused shims:", JSON.stringify(shimReport.unused));
const issues = [...shimReport.missingReferenced.map(p => p + ": imported compatibility shim missing"),
  ...shimReport.reintroduced.map(p => p + ": retired M13 shim must not return"),
  ...shimReport.unused.map(p => p + ": unreferenced legacy shim must be deleted"),
  ...checkPhysicalDomain(), ...checkHostConsumption(), ...validateArchitecture(files),
  ...validatePortableBoundaries(files, { requireManifest: true }),
  ...legacy.map((pathname) => `${pathname}: tests must live with their application/domain owner`)];
if (issues.length > 0) {
  console.error("Architecture boundary violations:\n" + issues.map((issue) => " - " + issue).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture boundaries and M0 portable-core contract OK (${files.length} source files checked)`);
}
