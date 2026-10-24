import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const directory = resolve("packages/core");
const out = resolve(directory, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/**
 * One source graph for ESM, CJS and declarations. Nothing in the package's
 * source facade implements application behavior. Any host-only dependency is
 * a fatal packaging regression even when the existing Obsidian build succeeds.
 */
// Compile the stateful engine exactly once. Both entrypoints load this object.
const result = await build({
    entryPoints: [resolve(directory, "src/index.ts")],
    outfile: resolve(out, "index.cjs"),
    bundle: true,
    format: "cjs",
    platform: "neutral",
    target: "es2022",
    treeShaking: true,
    metafile: true,
    logLevel: "silent",
  });
  const hostModules = new Set([
    "main.ts", "ChatView.ts", "ObsidianContext.ts", "VaultProgramStore.ts",
    "VaultLearningStore.ts", "PluginDataRepository.ts", "MutationService.ts",
    "ChatGptAuth.ts", "CodexAdapter.ts",
  ]);
  const outsidePackage = Object.keys(result.metafile.inputs).filter(name =>
    !name.replaceAll(String.fromCharCode(92), "/").startsWith("packages/core/src/"));
  const forbidden = Object.keys(result.metafile.inputs).filter(name => {
    const pathname = name.split(String.fromCharCode(92)).join("/");
    const basename = pathname.split("/").at(-1);
    return pathname.includes("src/host/") ||
      pathname.includes("node_modules/obsidian/") ||
      pathname.includes("node_modules/electron/") ||
      (pathname.includes("src/") && hostModules.has(basename));
  });
  const unresolved = Object.values(result.metafile.outputs).flatMap(entry =>
    entry.imports.filter(dependency => dependency.external).map(dependency => dependency.path));
  if (forbidden.length || unresolved.length || outsidePackage.length) {
    throw new Error(`Core CJS source boundary violation: ${[...forbidden, ...unresolved, ...outsidePackage].join(", ")}`);
  }
console.log(`@nox/core canonical CJS bundled ${Object.keys(result.metafile.inputs).length} source files`);

// The ESM file is a thin facade over the CJS module's one set of constructors.
// Reflect actual runtime exports from the canonical bundle. No manually
// maintained second API list can diverge from index.ts.
const require = createRequire(import.meta.url);
const runtimeExports = Object.keys(require(resolve(out, "index.cjs"))).sort();
if (!runtimeExports.length || runtimeExports.some(name =>
  !/^[A-Za-z_$][\\w$]*$/.test(name) || name === "default")) {
  throw new Error("Invalid @nox/core CJS runtime export surface");
}
writeFileSync(resolve(out, "index.mjs"), [
  'import runtime from "./index.cjs";',
  ...runtimeExports.map(name => `export const ${name} = runtime.${name};`),
  "",
].join("\n"));

const tsc = spawnSync(process.execPath, [
  resolve("node_modules/typescript/bin/tsc"),
  "--project", resolve(directory, "tsconfig.build.json"),
], { stdio: "inherit" });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// Standalone tsconfig: declarations are emitted directly inside the package.
// No baseUrl import rewrites or references to the monorepo source graph.
const declarationsRoot = resolve(out, "types");
function checkDeclarations(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) { checkDeclarations(file); continue; }
    if (!entry.name.endsWith(".d.ts")) continue;
    const source = readFileSync(file, "utf8");
    if (source.includes("packages/core/src") ||
        source.includes("../../../src/") ||
        source.includes('import("obsidian")') ||
        source.includes('from "obsidian"')) {
      throw new Error("Core declarations contain a monorepo or host reference: " + file);
    }
  }
}
checkDeclarations(declarationsRoot);
if (!existsSync(resolve(out, "types/index.d.ts"))) {
  throw new Error("Missing @nox/core package-local declaration entrypoint");
}
console.log("@nox/core independent-source ESM/CJS/declaration artifacts are ready");
