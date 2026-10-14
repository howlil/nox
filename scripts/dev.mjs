import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { createNoxBuildOptions, tailwindCliPath } from "../esbuild.config.mjs";
import {
  DevPublishQueue, NOX_PLUGIN_ID, syncDevelopmentArtifacts, validateDevVault,
} from "./dev-core.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) {
    throw new Error(name + " requires a value.");
  }
  return process.argv[index + 1];
}

if (process.argv.includes("--help")) {
  console.log("Usage: pnpm dev -- [--vault PATH] [--vault-name NAME] [--reload cli|hot-reload|none]");
  process.exit(0);
}
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

const defaultVault = path.join(process.env.USERPROFILE || os.homedir(), "Documents", "howlil");
const targetVault = validateDevVault(option("--vault") || process.env.NOX_DEV_VAULT || defaultVault);
const vaultName = option("--vault-name") || process.env.NOX_DEV_VAULT_NAME || path.basename(targetVault);
const reloadMode = option("--reload") || process.env.NOX_DEV_RELOAD || "cli";
if (!["cli", "hot-reload", "none"].includes(reloadMode)) {
  throw new Error("NOX_DEV_RELOAD must be cli, hot-reload, or none.");
}
const cli = process.env.NOX_OBSIDIAN_CLI || "obsidian";
const dist = path.resolve("dist");
const tailwind = tailwindCliPath();

if (!fs.existsSync(tailwind)) {
  throw new Error("Tailwind CLI not installed. Run pnpm install before pnpm dev.");
}
fs.mkdirSync(dist, { recursive: true });

function compileCssOnce() {
  const result = spawnSync(process.execPath, [
    tailwind, "-i", "styles.css", "-o", path.join(dist, "styles.css"),
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Initial Tailwind build failed.");
}

function reloadWithCli() {
  return new Promise((resolve, reject) => {
    const args = [
      "vault=" + vaultName, "plugin:reload", "id=" + NOX_PLUGIN_ID,
    ];
    const child = spawn(cli, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let diagnostic = "";
    child.stdout.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-4096); });
    child.stderr.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-4096); });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Obsidian CLI reload timed out. Check the open vault."));
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error("Obsidian CLI unavailable: " + error.message +
        ". Enable Obsidian CLI or select --reload hot-reload."));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error("Obsidian plugin reload failed (" + code + "): " + diagnostic.trim()));
    });
  });
}

let jsHealthy = false;
let cssHealthy = false;
let initialPublish = true;
let closing = false;
const queue = new DevPublishQueue({
  delayMs: 850,
  publish: async () => {
    if (!jsHealthy || !cssHealthy || closing) return;
    const { target, changed, mainHash } = syncDevelopmentArtifacts({
      targetVault, distDir: dist, reloadMode,
    });
    if (!changed.length && !initialPublish) return;
    if (reloadMode === "cli") {
      await reloadWithCli();
    } else if (reloadMode === "hot-reload" && !changed.length) {
      // Initial build can match disk while Obsidian has an older JS in memory.
      fs.utimesSync(path.join(target, "main.js"), new Date(), new Date());
    }
    initialPublish = false;
    console.log("[NOX DEV] " + (changed.length ? changed.join(", ") : "already synchronized") +
      " -> " + target);
    console.log("[NOX DEV] " + (reloadMode === "cli" ? "Reload requested" :
      reloadMode === "hot-reload" ? "Waiting for Hot-Reload plugin" : "Reload disabled") +
      " | SHA256(main.js)=" + mainHash.slice(0, 12));
  },
  onError: (error) => console.error("[NOX DEV] Publish failed; keeping watcher active:", error),
});

console.log("[NOX DEV] Vault:", targetVault);
console.log("[NOX DEV] Reload:", reloadMode);
compileCssOnce();
cssHealthy = true;

const cssWatcher = fs.watch(dist, (_event, filename) => {
  if (filename?.toString() === "styles.css") queue.schedule();
});

const cssProcess = spawn(process.execPath, [
  tailwind, "-i", "styles.css", "-o", path.join(dist, "styles.css"), "--watch",
], { stdio: ["ignore", "pipe", "pipe"] });

cssProcess.stdout.on("data", (chunk) => process.stdout.write("[TAILWIND] " + chunk.toString()));
cssProcess.stderr.on("data", (chunk) => process.stderr.write("[TAILWIND] " + chunk.toString()));
cssProcess.on("error", (error) => {
  cssHealthy = false;
  console.error("[NOX DEV] Tailwind watch failed:", error);
});
cssProcess.on("exit", (code) => {
  if (closing) return;
  cssHealthy = false;
  queue.cancelPending();
  console.error("[NOX DEV] Tailwind watch stopped (" + code + "). Restart pnpm dev.");
});

const context = await esbuild.context(createNoxBuildOptions({
  onStart: () => { jsHealthy = false; queue.cancelPending(); },
  onBuild: (success) => {
    jsHealthy = success;
    if (success) queue.schedule();
    else {
      queue.cancelPending();
      console.error("[NOX DEV] TypeScript build failed; previous installed bundle remains.");
    }
  },
}));
await context.watch();
console.log("[NOX DEV] Watching TypeScript + Tailwind. Ctrl+C to stop.");

async function shutdown() {
  if (closing) return;
  closing = true;
  cssWatcher.close();
  cssProcess.kill();
  await queue.stop();
  await context.dispose();
}
process.once("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
