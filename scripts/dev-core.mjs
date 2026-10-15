import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const NOX_PLUGIN_ID = "nox";
export const REQUIRED_DEV_ARTIFACTS = ["manifest.json", "styles.css", "main.js"];

export function validateDevVault(vaultPath) {
  if (!vaultPath || typeof vaultPath !== "string") {
    throw new Error("Set NOX_DEV_VAULT or pass --vault <absolute-path>.");
  }
  const vault = path.resolve(vaultPath);
  const config = path.join(vault, ".obsidian");
  if (!fs.existsSync(config) || !fs.statSync(config).isDirectory()) {
    throw new Error("Target is not an Obsidian vault (missing .obsidian directory): " + vault);
  }
  return vault;
}

function contentHash(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

/**
 * Synchronize only validated, completed artifacts into a known vault.
 * main.js is written last so both CLI reload and .hotreload observe a
 * complete build. Files are compared first to suppress redundant reloads.
 */
export function syncDevelopmentArtifacts({
  targetVault, distDir, pluginId = NOX_PLUGIN_ID, reloadMode = "cli",
}) {
  const vault = validateDevVault(targetVault);
  if (!["cli", "hot-reload", "none"].includes(reloadMode)) {
    throw new Error("Unknown reload mode: " + reloadMode);
  }
  const manifestPath = path.join(distDir, "manifest.json");
  for (const filename of REQUIRED_DEV_ARTIFACTS) {
    const source = path.join(distDir, filename);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error("Missing development artifact: " + source);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== pluginId) {
    throw new Error("Manifest plugin ID does not match expected target: " + pluginId);
  }
  const target = path.join(vault, ".obsidian", "plugins", pluginId);
  fs.mkdirSync(target, { recursive: true });

  const marker = path.join(target, ".hotreload");
  const markerContents = "managed by NOX development orchestrator\n";
  if (reloadMode === "hot-reload") {
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, markerContents);
  } else if (fs.existsSync(marker)) {
    if (fs.readFileSync(marker, "utf8") === markerContents) {
      fs.rmSync(marker);
    } else if (reloadMode === "cli") {
      throw new Error(
        "Existing .hotreload marker conflicts with CLI reload. Remove it or use --reload hot-reload.",
      );
    }
  }

  const changed = [];
  const optional = ["nox.png"];
  // The main bundle is committed last; only files owned by the build are copied.
  for (const filename of ["manifest.json", "nox.png", "styles.css", "main.js"]) {
    const source = path.join(distDir, filename);
    if (optional.includes(filename) && !fs.existsSync(source)) continue;
    const dest = path.join(target, filename);
    if (fs.existsSync(dest) && contentHash(source) === contentHash(dest)) continue;
    const temp = dest + ".nox-dev-tmp";
    try {
      fs.copyFileSync(source, temp);
      fs.renameSync(temp, dest);
    } finally {
      if (fs.existsSync(temp)) fs.rmSync(temp);
    }
    changed.push(filename);
  }
  return { target, changed, mainHash: contentHash(path.join(target, "main.js")) };
}

/** Coalesce bursts and never overlap reloads. A publish failure is logged,
 * but future changes remain eligible to recover the development session.
 */
export class DevPublishQueue {
  constructor({ publish, delayMs = 650, onError = (error) => console.error(error) }) {
    this.publish = publish;
    this.delayMs = delayMs;
    this.onError = onError;
    this.timer = null;
    this.running = null;
    this.dirty = false;
    this.stopped = false;
  }

  schedule() {
    if (this.stopped) return;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
  }

  cancelPending() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dirty = false;
  }

  async flush() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running || !this.dirty) return this.running;
    this.dirty = false;
    this.running = (async () => {
      try {
        await this.publish();
      } catch (error) {
        this.onError(error);
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
      if (this.dirty && !this.stopped) this.schedule();
    }
  }

  async stop() {
    this.stopped = true;
    this.cancelPending();
    if (this.running) await this.running;
  }
}
