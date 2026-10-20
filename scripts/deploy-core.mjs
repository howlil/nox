import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";

const REQUIRED_FILES = ["manifest.json", "styles.css", "main.js"];

function sha256(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

/** Verify bytes after installation, not only that the source build succeeded. */
export function verifyDeployedPlugin({ distDir, pluginDir }) {
  const digests = {};
  for (const filename of REQUIRED_FILES) {
    const src = path.join(distDir, filename);
    const installed = path.join(pluginDir, filename);
    if (!fs.existsSync(src) || !fs.existsSync(installed)) {
      throw new Error("Missing deployment artifact: " + filename);
    }
    const expected = sha256(src), actual = sha256(installed);
    if (actual !== expected) {
      throw new Error("Installed artifact mismatch: " + filename + ". Reload is unsafe.");
    }
    digests[filename] = actual;
  }
  return digests;
}

export function deployPlugin({
  targetVault,
  distDir,
  pluginId = "nox",
  logger = console,
}) {
  if (!fs.existsSync(distDir)) {
    throw new Error(
      "dist/ directory not found. Please run 'pnpm run build' first.",
    );
  }
  if (!fs.existsSync(path.join(targetVault, ".obsidian")) ||
      !fs.statSync(path.join(targetVault, ".obsidian")).isDirectory()) {
    throw new Error(
      "Target is not an Obsidian vault (missing .obsidian directory): " + targetVault,
    );
  }
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    if (!fs.existsSync(path.join(distDir, file)) ||
        !fs.statSync(path.join(distDir, file)).isFile()) {
      throw new Error("Missing required plugin build output: dist/" + file);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.json"), "utf8"));
  if (manifest.id !== pluginId) {
    throw new Error("Build manifest plugin id does not match deployment target.");
  }

  const pluginDest = path.join(
    targetVault,
    ".obsidian",
    "plugins",
    pluginId,
  );

  fs.mkdirSync(pluginDest, { recursive: true });

  // Install only plugin artifacts. Commit main.js last so reload never sees a
  // new bundle with stale CSS/manifest; temp + rename prevents partial file reads.
  for (const file of ["manifest.json", "styles.css", "nox.png", "main.js"]) {
    const src = path.join(distDir, file);
    if (file === "nox.png" && !fs.existsSync(src)) continue;
    const dest = path.join(pluginDest, file);
    const temp = dest + ".nox-deploy-tmp";
    try {
      fs.copyFileSync(src, temp);
      fs.renameSync(temp, dest);
    } finally {
      if (fs.existsSync(temp)) fs.rmSync(temp);
    }
    logger.log(`  ✓ Copied ${file}`);
  }
  verifyDeployedPlugin({ distDir, pluginDir: pluginDest });

  // A production deploy must not inherit the marker created by pnpm dev.
  // Leave user-owned markers untouched; only remove the orchestrator marker.
  const devMarker = path.join(pluginDest, ".hotreload");
  if (fs.existsSync(devMarker) &&
      fs.readFileSync(devMarker, "utf8") === "managed by NOX development orchestrator\n") {
    fs.rmSync(devMarker);
  }

  const communityPluginsPath = path.join(
    targetVault,
    ".obsidian",
    "community-plugins.json",
  );

  try {
    let plugins = [];
    if (fs.existsSync(communityPluginsPath)) {
      plugins = JSON.parse(
        fs.readFileSync(
          communityPluginsPath,
          "utf-8",
        ),
      );
    }

    if (!Array.isArray(plugins)) {
      throw new Error(
        "community-plugins.json must contain an array.",
      );
    }

    if (!plugins.includes(pluginId)) {
      plugins.push(pluginId);
      fs.mkdirSync(
        path.dirname(communityPluginsPath),
        { recursive: true },
      );
      fs.writeFileSync(
        communityPluginsPath,
        JSON.stringify(plugins, null, 2),
        "utf-8",
      );
      logger.log(
        `  ✓ Added '${pluginId}' to community-plugins.json`,
      );
    }
  } catch (error) {
    logger.warn(
      "  ⚠ Could not auto-enable in community-plugins.json:",
      error instanceof Error
        ? error.message
        : String(error),
    );
  }

  return pluginDest;
}
