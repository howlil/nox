import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

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
  if (forbidden.length || unresolved.length) {
    throw new Error(`Core CJS contains host imports: ${[...forbidden, ...unresolved].join(", ")}`);
  }
console.log(`@nox/core canonical CJS bundled ${Object.keys(result.metafile.inputs).length} source files`);

// The ESM file is a thin facade over the CJS module's one set of constructors.
const runtimeExports = [
  "AgentRuntime", "LearningController", "LearningProgramOrchestrator",
  "SessionController", "SessionStore", "ContextResolver",
  "DEFAULT_LEARNING_STATE", "decodeLearningState",
  "PersistenceError", "LearningStateWriteConflict", "SessionWriteConflict",
];
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

// The declaration emitter can synthesize a baseUrl-based import() for a type
// exposed by our own public index. That path only resolves inside this monorepo
// and must be rewritten to a relative path inside the shipped type graph.
const declarationsRoot = resolve(out, "types");
const publicModule = resolve(declarationsRoot, "packages/core/src");
function checkDeclarations(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) { checkDeclarations(file); continue; }
    if (!entry.name.endsWith(".d.ts")) continue;
    const source = readFileSync(file, "utf8");
    const specifier = relative(dirname(file), publicModule).split(sep).join("/");
    const target = specifier.startsWith(".") ? specifier : "./" + specifier;
    const fixed = source
      .replaceAll('"packages/core/src"', '"' + target + '"')
      .replaceAll("'packages/core/src'", "'" + target + "'");
    if (fixed.includes('import("obsidian")') || fixed.includes('from "obsidian"')) {
      throw new Error("Portable core declarations reference the Obsidian SDK: " + file);
    }
    if (fixed !== source) writeFileSync(file, fixed);
  }
}
checkDeclarations(declarationsRoot);

if (!existsSync(resolve(out, "types/packages/core/src/index.d.ts"))) {
  throw new Error("Missing @nox/core public TypeScript declaration entrypoint");
}
console.log("@nox/core standalone ESM/CJS and declaration artifacts are ready");
