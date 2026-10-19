import {
  existsSync,
  readFileSync,
} from "fs";
import { assertCompiledPluginCss, assertLandingDialogCss } from "./css-artifact-policy.mjs";

const required = [
  "dist/main.js",
  "dist/styles.css",
  "dist/manifest.json",
  "dist/nox.png",
];

for (const path of required) {
  if (!existsSync(path)) {
    throw new Error(`Missing build artifact: ${path}`);
  }
}

if (existsSync("dist/.hotreload")) {
  throw new Error("Development Hot-Reload marker must not be included in production artifacts.");
}

if (existsSync("main.js")) {
  throw new Error("Obsolete root main.js is tracked or generated; use dist/main.js only.");
}

if (existsSync("dist/forge.png")) {
  throw new Error("Legacy brand artifact must not exist: dist/forge.png");
}

// Community reviewers inspect the built CSS, not Tailwind input directives.
assertCompiledPluginCss(readFileSync("dist/styles.css", "utf8"));
assertLandingDialogCss(readFileSync("landing/src/components/arc/dialog/dialog.module.css", "utf8"));

const manifest = JSON.parse(
  readFileSync("dist/manifest.json", "utf8"),
);
const pkg = JSON.parse(
  readFileSync("package.json", "utf8"),
);

if (manifest.id !== "nox") {
  throw new Error(
    `Unexpected plugin id: ${String(manifest.id)}`,
  );
}

if (manifest.name !== "Nox") {
  throw new Error(
    `Unexpected plugin name: ${String(manifest.name)}`,
  );
}

if (pkg.main !== "dist/main.js") {
  throw new Error(
    `Unexpected package main: ${String(pkg.main)}`,
  );
}

if (manifest.version !== pkg.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error("Manifest/package versions must match semantic x.y.z format.");
}
if (!manifest.description.endsWith(".") || manifest.description.length > 250) {
  throw new Error("Community Directory description must end in a period and use <=250 characters.");
}
if (manifest.isDesktopOnly !== true) {
  throw new Error("Node/Electron runtime requires isDesktopOnly=true.");
}

// CI must reject a build that cannot reveal its loaded runtime identity.
// A successful build alone does not prove Obsidian is executing this bundle.
const mainBundle = readFileSync("dist/main.js", "utf8");
if (!mainBundle.includes("data:image/svg+xml;base64,")) {
  throw new Error("Nox logo must be embedded: Obsidian does not install extra image assets.");
}
if (!mainBundle.includes("NOX_RUNTIME_TRANSPORT_V3:node-https-sse")) {
  throw new Error("Build is missing its ChatGPT HTTP transport marker.");
}

// Track the production bundle cost of optional graph layout libraries.
const mainBundleBytes = Buffer.byteLength(mainBundle, "utf8");
console.log(`NOX production JavaScript: ${mainBundleBytes} bytes (${(mainBundleBytes / 1048576).toFixed(2)} MiB).`);
console.log("Nox build artifacts verified with runtime transport marker.");
