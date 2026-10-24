import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "check" && mode !== "demo") {
  console.error("Usage: node scripts/headless.mjs check|demo [--data-dir PATH]");
  process.exit(2);
}
const temporary = mkdtempSync(join(tmpdir(), "nox-headless-build-"));
try {
  const outfile = join(temporary, "cli.mjs");
  const result = await build({
    entryPoints: ["headless/src/cli.ts"],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    metafile: true,
    logLevel: "silent",
  });
  const forbidden = Object.keys(result.metafile.inputs).filter(file =>
    /(^|\/)(main\.ts|ChatView\.ts|ObsidianContext\.ts|VaultProgramStore\.ts|VaultLearningStore\.ts|PluginDataRepository\.ts|ChatGptAuth\.ts|CodexAdapter\.ts)$/.test(file) ||
    file.includes("node_modules/obsidian/") || file.includes("node_modules/electron/"));
  if (forbidden.length > 0) throw new Error("Headless bundle pulls Obsidian/desktop adapters: " + forbidden.join(", "));
  console.log("Headless NOX dependency graph OK (" + Object.keys(result.metafile.inputs).length + " bundled source inputs).");
  if (mode === "demo") {
    const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(3)], { stdio: "inherit" });
    process.exitCode = run.status ?? 1;
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
