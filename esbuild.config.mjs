import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import builtins from "builtin-modules";

const BUILD_TIMESTAMP_PLACEHOLDER = "NOX_DEV_BUILD_TIMESTAMP_PLACEHOLDER";

function currentRevision() {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export function tailwindCliPath() {
  return path.resolve("node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
}

function compileProductionCss() {
  execFileSync(process.execPath, [
    tailwindCliPath(), "-i", "styles.css",
    "-o", path.join("dist", "styles.css"), "--minify",
  ], { stdio: "inherit" });
}

/** Shared build config: release is self-contained, dev delegates CSS watch
 * and synchronized deployment to scripts/dev.mjs.
 */
export function createNoxBuildOptions({ production = false, onStart, onBuild } = {}) {
  const revision = currentRevision();
  return {
    entryPoints: ["src/main.ts"],
    define: {
      __NOX_BUILD_REVISION__: JSON.stringify(revision),
      // Obsidian Community installs exactly three files. Inlining avoids
      // a runtime file dependency and keeps source import boundaries intact.
      __NOX_LOGO_DATA_URI__: JSON.stringify(
        "data:image/png;base64," + fs.readFileSync(path.join("public", "nox.png")).toString("base64"),
      ),
      __NOX_BUILD_TIMESTAMP__: JSON.stringify(
        production ? new Date().toISOString() : BUILD_TIMESTAMP_PLACEHOLDER,
      ),
      __NOX_BUILD_TRANSPORT__: JSON.stringify("NOX_RUNTIME_TRANSPORT_V3:node-https-sse"),
      __NOX_DEV_BUILD__: JSON.stringify(!production),
    },
    bundle: true,
    external: [
      "obsidian",
      "electron",
      "@codemirror/autocomplete",
      "@codemirror/collab",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      ...builtins,
    ],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: production ? false : "inline",
    treeShaking: true,
    outfile: "dist/main.js",
    minify: production,
    plugins: [{
      name: "nox-build-artifacts",
      setup(build) {
        build.onStart(() => { onStart?.(); });
        build.onEnd(async (result) => {
          if (result.errors.length) {
            await onBuild?.(false);
            return;
          }
          try {
            fs.mkdirSync("dist", { recursive: true });
            for (const file of ["manifest.json"]) {
              fs.copyFileSync(file, path.join("dist", file));
            }
            const logo = path.join("public", "nox.png");
            if (fs.existsSync(logo)) {
              fs.copyFileSync(logo, path.join("dist", "nox.png"));
            }
            if (production) {
              const marker = path.join("dist", ".hotreload");
              if (fs.existsSync(marker)) fs.rmSync(marker);
              compileProductionCss();
            } else {
              // A new identity on every incremental JS build, not only when
              // the long-lived watch process was first started.
              const bundlePath = path.join("dist", "main.js");
              const bundle = fs.readFileSync(bundlePath, "utf8");
              if (!bundle.includes(BUILD_TIMESTAMP_PLACEHOLDER)) {
                throw new Error("Development bundle has no build timestamp placeholder.");
              }
              fs.writeFileSync(
                bundlePath,
                bundle.replace(BUILD_TIMESTAMP_PLACEHOLDER, new Date().toISOString()),
              );
            }
            await onBuild?.(true);
          } catch (error) {
            await onBuild?.(false);
            throw error;
          }
        });
      },
    }],
  };
}

const executedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executedDirectly) {
  const production = process.argv[2] === "production";
  const context = await esbuild.context(createNoxBuildOptions({ production }));
  if (production) {
    try {
      await context.rebuild();
    } finally {
      await context.dispose();
    }
  } else {
    console.warn("Use 'pnpm dev' for CSS watch, vault sync, and automatic Obsidian reload.");
    await context.watch();
  }
}
