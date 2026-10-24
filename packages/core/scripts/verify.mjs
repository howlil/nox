import "./build.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const cjs = require(resolve(packageRoot, "dist/index.cjs"));
const esm = await import(pathToFileURL(resolve(packageRoot, "dist/index.mjs")).href);
assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort(),
  "Standalone ESM and CJS public runtime exports must match");
for (const name of Object.keys(cjs)) {
  assert.strictEqual(esm[name], cjs[name], "Duplicate runtime object: " + name);
}
const declarations = readFileSync(resolve(packageRoot, "dist/types/index.d.ts"), "utf8");
for (const name of ["LearningController", "SessionController", "LearningProgramOrchestrator"]) {
  assert.ok(declarations.includes(name), "Missing declaration: " + name);
}
console.log("@nox/core package-owned build + runtime/type identity accepted");
