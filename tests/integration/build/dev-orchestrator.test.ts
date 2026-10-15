import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("dev orchestrator builds and deploys into a temporary vault without Obsidian CLI", async () => {
  const root = mkdtempSync(join(tmpdir(), "nox-dev-smoke-"));
  const vault = join(root, "test-vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  const installed = join(vault, ".obsidian", "plugins", "nox");

  const child = spawn(process.execPath, [
    "scripts/dev.mjs", "--vault", vault, "--reload", "none",
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-8000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-8000); });
  let exited = false;
  child.once("exit", () => { exited = true; });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (exited) break;
      const main = join(installed, "main.js");
      const css = join(installed, "styles.css");
      if (existsSync(main) && existsSync(css) &&
          readFileSync(main, "utf8").includes("NOX_RUNTIME_TRANSPORT_V3:node-https-sse") &&
          readFileSync(css, "utf8").length > 100) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(ready, true, "Dev pipeline failed to publish after 20s:\n" + output);
    assert.equal(existsSync(join(installed, ".hotreload")), false);
    assert.equal(existsSync(join(installed, "manifest.json")), true);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (exited) { resolve(); return; }
      child.once("exit", () => resolve());
      setTimeout(resolve, 4000);
    });
    rmSync(root, { recursive: true, force: true });
  }
});
