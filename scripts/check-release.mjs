import fs from "node:fs";
import { parseVersion } from "./prepare-release.mjs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = manifest.version;
parseVersion(version);
if (manifest.id !== "nox" || manifest.isDesktopOnly !== true) throw new Error("Invalid Obsidian release identity/platform.");
if (version !== pkg.version) throw new Error("manifest.json and package.json versions disagree.");
if (!fs.existsSync(".release-plan.json")) {
  console.log("Release metadata matches; no release plan prepared.");
  process.exit(0);
}
const plan = JSON.parse(fs.readFileSync(".release-plan.json", "utf8"));
if (plan.version !== version) throw new Error("Release plan and manifest versions disagree.");
if (!["current", "patch", "minor", "major"].includes(plan.bump)) throw new Error("Unexpected release bump.");
parseVersion(plan.previousVersion);
const text = fs.readFileSync("CHANGELOG.md", "utf8");
if (!text.includes("## [" + version + "]")) throw new Error("Changelog has no entry for planned release.");
console.log("Release metadata and CHANGELOG match " + version + ".");
