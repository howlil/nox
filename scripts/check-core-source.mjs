import { spawnSync } from "node:child_process";
import { cp, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

/** Source-only proof: no root src, root config or monorepo runtime code is staged. */
const stage = await mkdtemp(join(tmpdir(), "nox-core-source-only-"));
const pkg = join(stage, "core");
try {
  await mkdir(pkg, { recursive: true });
  await cp(resolve("packages/core/src"), join(pkg, "src"), { recursive: true });
  await copyFile(resolve("packages/core/package.json"), join(pkg, "package.json"));
  await copyFile(resolve("packages/core/tsconfig.build.json"), join(pkg, "tsconfig.build.json"));

  const compile = spawnSync(process.execPath, [
    resolve("node_modules/typescript/bin/tsc"), "--project", join(pkg, "tsconfig.build.json"),
  ], { cwd: stage, encoding: "utf8", timeout: 60_000 });
  if (compile.status !== 0) throw new Error("Isolated source declarations failed:\n" +
    compile.stdout + "\n" + compile.stderr);

  const manifest = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));
  if (manifest.private !== true) throw new Error("Core must remain private");
  if (manifest.scripts?.build !== "node ./scripts/build.mjs" ||
      manifest.scripts?.verify !== "node ./scripts/verify.mjs" ||
      !manifest.devDependencies?.esbuild || !manifest.devDependencies?.typescript) {
    throw new Error("Core must own its build script and toolchain dependencies");
  }
  const types = manifest.exports?.["."]?.types;
  if (types !== "./dist/types/index.d.ts") throw new Error("Nonportable types export path");
  const exported = await readFile(join(pkg, types), "utf8");
  if (!exported.includes("LearningController")) {
    throw new Error("Package-local declarations missing the public controller");
  }
  const bundled = await build({
    entryPoints: [join(pkg, "src/index.ts")],
    outfile: join(pkg, "source-proof.cjs"),
    bundle: true, format: "cjs", platform: "neutral", target: "es2022",
    absWorkingDir: stage, metafile: true, logLevel: "silent",
  });
  const inputs = Object.keys(bundled.metafile.inputs).map(p => p.replaceAll("\\", "/"));
  const escaped = inputs.filter(p => !p.startsWith("core/src/"));
  const external = Object.values(bundled.metafile.outputs)
    .flatMap(out => out.imports).filter(i => i.external).map(i => i.path);
  const required = ["core/src/index.ts", "core/src/agent/AgentRuntime.ts",
    "core/src/application/LearningController.ts",
    "core/src/application/LearningProgramOrchestrator.ts",
    "core/src/session/SessionController.ts"];
  const missing = required.filter(file => !inputs.includes(file));
  if (escaped.length || external.length || missing.length) {
    throw new Error("Isolated source graph escaped canonical package: " +
      [...escaped, ...external, ...missing].join(", ") + " (" + inputs.length + " modules)");
  }

  const smoke = `const assert = require("node:assert/strict");
const core = require(process.argv[1]);
for (const name of ["AgentRuntime", "LearningController",
  "LearningProgramOrchestrator", "SessionController", "SessionStore",
  "ContextResolver", "ProgramWriteConflict"]) {
  assert.equal(typeof core[name], "function", name);
}
assert.equal(core.DEFAULT_LEARNING_STATE.evidence.length, 0);
console.log("Isolated source-only runtime smoke passed");`;
  const runtime = spawnSync(process.execPath,
    ["-e", smoke, join(pkg, "source-proof.cjs")],
    { cwd: stage, encoding: "utf8", timeout: 15_000 });
  if (runtime.status !== 0) throw new Error("Isolated source runtime failed:\n" +
    runtime.stdout + "\n" + runtime.stderr);
  process.stdout.write(runtime.stdout);
  console.log("Isolated source TypeScript and bundle graph accepted: " +
    inputs.length + " canonical source modules");
} finally {
  await rm(stage, { recursive: true, force: true });
}
