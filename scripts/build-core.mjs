import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve("packages/core");
const out = resolve(directory, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/**
 * One source graph for ESM, CJS and declarations. Nothing in the package's
 * source facade implements application behavior. Any host-only dependency is
 * a fatal packaging regression even when the existing Obsidian build succeeds.
 */
for (const [format, file] of [["esm", "index.mjs"], ["cjs", "index.cjs"]]) {
  const result = await build({
    entryPoints: [resolve(directory, "src/index.ts")],
    outfile: resolve(out, file),
    bundle: true,
    format,
    platform: "neutral",
    target: "es2020",
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
    throw new Error(`Core ${format} contains host imports: ${[...forbidden, ...unresolved].join(", ")}`);
  }
  console.log(`@nox/core ${format} bundled ${Object.keys(result.metafile.inputs).length} source files`);
}

const tsc = spawnSync(process.execPath, [
  resolve("node_modules/typescript/bin/tsc"),
  "--project", resolve(directory, "tsconfig.build.json"),
], { stdio: "inherit" });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
if (!existsSync(resolve(out, "types/packages/core/src/index.d.ts"))) {
  throw new Error("Missing @nox/core public TypeScript declaration entrypoint");
}
console.log("@nox/core standalone ESM/CJS and declaration artifacts are ready");
