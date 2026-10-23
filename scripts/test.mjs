import { build } from "esbuild";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { tmpdir } from "os";
import { join, resolve, sep } from "path";
import { spawnSync } from "child_process";

const mode = process.argv[2] ?? "all";
const allowedModes = new Set(["unit", "integration", "all"]);

if (!allowedModes.has(mode)) {
  console.error(`Unknown test mode: ${mode}`);
  process.exit(2);
}

function collectFiles(path) {
  if (statSync(path).isFile()) return [path];

  return readdirSync(path).flatMap((entry) =>
    collectFiles(join(path, entry)),
  );
}

const allTests = collectFiles("tests").filter((path) =>
  path.endsWith(".test.ts"),
);

const selected = allTests.filter((path) => {
  const integration = path.includes(
    `${join("tests", "integration")}${sep}`,
  );

  if (mode === "integration") return integration;
  if (mode === "unit") return !integration;
  return true;
});

if (selected.length === 0) {
  console.log(`No ${mode} tests found.`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "nox-tests-"));

try {
  await build({
    entryPoints: selected,
    outdir: dir,
    outbase: "tests",
    entryNames: "[dir]/[name]",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    alias: {
      obsidian: resolve("tests/support/obsidian.ts"),
    },
    logLevel: "silent",
  });

  const compiled = collectFiles(dir).filter((path) =>
    path.endsWith(".mjs"),
  );

  const run = spawnSync(
    process.execPath,
    ["--test", ...compiled],
    { stdio: "inherit" },
  );

  process.exitCode = run.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
