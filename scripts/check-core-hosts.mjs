import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

/**
 * Build each host's composition as a graph, not a second runtime artifact.
 * Every @nox/core import MUST resolve through the monorepo source facade;
 * never mix dist/index.mjs and source classes in one process.
 */
const entrypoints = [
  "src/host/obsidian/composition.ts",
  "headless/src/composition.ts",
];
for (const entry of entrypoints) {
  const source = readFileSync(entry, "utf8");
  if (!source.includes('from "@nox/core"')) {
    throw new Error(entry + ": host must consume @nox/core's public API");
  }
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    metafile: true,
    logLevel: "silent",
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*",
      ...builtinModules, ...builtinModules.map(name => "node:" + name)],
  });
  const inputs = Object.keys(result.metafile.inputs)
    .map(file => file.replaceAll(String.fromCharCode(92), "/"));
  const unique = [
    "packages/core/src/index.ts",
    "src/agent/AgentRuntime.ts",
    "src/application/LearningController.ts",
    "src/session/SessionController.ts",
    "src/session/SessionStore.ts",
    "src/domain/persistence/errors.ts",
  ];
  for (const single of unique) {
    const count = inputs.filter(file => file === single || file.endsWith("/" + single)).length;
    if (count !== 1) throw new Error(entry + ": " + single +
      " must exist exactly once; got " + count);
  }
  const duplicate = inputs.filter(file =>
    file.includes("packages/core/dist/") || file.includes("node_modules/@nox/core/"));
  if (duplicate.length) throw new Error(entry +
    ": bundled a second compiled core: " + duplicate.join(", "));
  const imports = Object.values(result.metafile.outputs)
    .flatMap(output => output.imports).filter(item => item.external)
    .map(item => item.path);
  if (imports.some(item => item === "@nox/core")) {
    throw new Error(entry + ": unresolved @nox/core import instead of source-alias");
  }
  console.log(entry + ": one canonical core, " + inputs.length + " inputs");
}
const main = readFileSync("src/main.ts", "utf8");
if (!main.includes('from "@nox/core"')) {
  throw new Error("Obsidian main.ts must use public core types");
}
console.log("M5 Obsidian and headless package-consumer identity graph OK");
