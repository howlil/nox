import fs from "fs";
import path from "path";

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

  const files = fs.readdirSync(distDir);
  for (const file of files) {
    const src = path.join(distDir, file);
    const dest = path.join(pluginDest, file);
    fs.copyFileSync(src, dest);
    logger.log(`  ✓ Copied ${file}`);
  }

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
