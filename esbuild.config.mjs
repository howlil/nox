import esbuild from "esbuild";
import { execFileSync } from "child_process";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

// Embed the exact git revision into the compiled plugin so Settings can prove
// which main.js was actually loaded by Obsidian.
let buildRevision = "unknown";
try {
  buildRevision = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch { /* Builds outside a git checkout remain identifiable by timestamp. */ }
const buildTimestamp = new Date().toISOString();
const buildTransport = "NOX_RUNTIME_TRANSPORT_V2:obsidian-requesturl";

// Plugin to compile the Tailwind CSS entry and copy plugin assets into dist/.
const copyAssetsPlugin = {
  name: "copy-assets",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;

      fs.mkdirSync("dist", { recursive: true });
      const assets = ["manifest.json", ".hotreload"];
      for (const asset of assets) {
        if (fs.existsSync(asset)) {
          fs.copyFileSync(asset, path.join("dist", asset));
        }
      }
      const logo = path.join("public", "nox.png");
      if (fs.existsSync(logo)) {
        fs.copyFileSync(logo, path.join("dist", "nox.png"));
      }

      const tailwind = path.resolve(
        "node_modules",
        "@tailwindcss",
        "cli",
        "dist",
        "index.mjs",
      );
      const args = [
        "-i",
        "styles.css",
        "-o",
        path.join("dist", "styles.css"),
      ];
      if (prod) args.push("--minify");
      execFileSync(process.execPath, [tailwind, ...args], {
        stdio: "inherit",
      });
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  define: {
    __NOX_BUILD_REVISION__: JSON.stringify(buildRevision),
    __NOX_BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
    __NOX_BUILD_TRANSPORT__: JSON.stringify(buildTransport),
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
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  minify: prod,
  plugins: [copyAssetsPlugin],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
