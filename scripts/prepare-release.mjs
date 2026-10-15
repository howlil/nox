import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function parseVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Version must be x.y.z without v prefix, prerelease, or leading zeros.");
  }
  return version.split(".").map(Number);
}

export function nextVersion(current, bump) {
  const [major, minor, patch] = parseVersion(current);
  switch (bump) {
    case "current": return current; // Bootstrap first public release only.
    case "patch": return major + "." + minor + "." + (patch + 1);
    case "minor": return major + "." + (minor + 1) + ".0";
    case "major": return (major + 1) + ".0.0";
    default: throw new Error("Bump must be current, patch, minor, or major.");
  }
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function releaseEntry(version, lines = [], initial = false) {
  const sections = { Features: [], Fixes: [], Performance: [], Documentation: [], Maintenance: [] };
  if (!initial) {
    for (const subject of lines) {
      const matched = /^(feat|fix|perf|docs|chore|refactor|test|build|ci)(?:\([^)]+\))?(!)?:\s+(.+)/i.exec(subject);
      if (!matched) continue;
      const category = { feat: "Features", fix: "Fixes", perf: "Performance", docs: "Documentation" }[matched[1].toLowerCase()] ?? "Maintenance";
      const detail = matched[3].replace(/[\r\n]+/g, " ").slice(0, 180);
      if (sections[category].length < 30) sections[category].push("- " + detail);
    }
  }
  let body = "## [" + version + "]\n\n";
  if (initial) return body + "Initial community release candidate for the Nox desktop learning companion.\n\n";
  const filled = Object.entries(sections).filter(([, entries]) => entries.length);
  if (!filled.length) return body + "Maintenance and compatibility updates.\n\n";
  for (const [heading, entries] of filled) body += "### " + heading + "\n\n" + entries.join("\n") + "\n\n";
  return body;
}

export function prependChangelog(original, entry, version) {
  const header = "# Changelog\n\n";
  if (original && !original.startsWith("# Changelog")) {
    throw new Error("Existing CHANGELOG.md must start with '# Changelog'.");
  }
  if (original?.includes("## [" + version + "]")) {
    throw new Error("Version " + version + " already exists in CHANGELOG.md.");
  }
  return header + entry + (original ? original.slice(header.length) : "");
}

export function prepare(bump) {
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (manifest.id !== "nox") throw new Error("Unexpected plugin ID.");
  if (manifest.version !== pkg.version) throw new Error("manifest/package versions disagree.");
  const oldVersion = manifest.version;
  const version = nextVersion(oldVersion, bump);
  const tags = git(["tag", "--list", "[0-9]*.[0-9]*.[0-9]*"]);
  const existingTags = tags ? tags.split("\n") : [];
  if (existingTags.includes(version)) throw new Error("Release tag already exists: " + version);
  if (bump === "current" && existingTags.length) {
    throw new Error("Current-version bootstrap is only valid before the first version tag.");
  }
  // Never replace an existing staged release plan. Require a merge of the previous release first.
  const prior = fs.existsSync(".release-plan.json") ? JSON.parse(fs.readFileSync(".release-plan.json", "utf8")) : null;
  if (prior && prior.version !== oldVersion) {
    throw new Error("Current manifest version does not match previous release plan.");
  }
  if (prior && prior.version === version) throw new Error("This version has already been prepared.");
  const range = existingTags.length ? existingTags.sort((a,b) => {
    const aa=parseVersion(a), bb=parseVersion(b);
    return bb[0]-aa[0] || bb[1]-aa[1] || bb[2]-aa[2];
  })[0] + "..HEAD" : "HEAD";
  const commits = git(["log", range, "--no-merges", "-80", "--format=%s"]).split("\n").filter(Boolean);
  const entry = releaseEntry(version, commits, bump === "current");
  const oldChangelog = fs.existsSync("CHANGELOG.md") ? fs.readFileSync("CHANGELOG.md","utf8") : "";
  const changelog = prependChangelog(oldChangelog, entry, version);
  manifest.version = version;
  pkg.version = version;
  // Compute all changes before writing.
  const plan = { version, previousVersion: oldVersion, bump };
  fs.writeFileSync("manifest.json", JSON.stringify(manifest,null,2) + "\n");
  fs.writeFileSync("package.json", JSON.stringify(pkg,null,2) + "\n");
  fs.writeFileSync("CHANGELOG.md", changelog);
  fs.writeFileSync(".release-plan.json", JSON.stringify(plan,null,2) + "\n");
  console.log("Prepared Nox release " + version + " (" + bump + ")");
  return plan;
}

if (process.argv[1] && path.basename(process.argv[1]) === "prepare-release.mjs" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bump = process.argv[2];
  try { prepare(bump); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
