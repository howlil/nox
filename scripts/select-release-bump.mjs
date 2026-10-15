import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { parseVersion } from "./prepare-release.mjs";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function inferReleaseBump(messages) {
  let level = 0;
  for (const raw of messages) {
    const subject = raw.split(/\r?\n/, 1)[0].trim();
    if (!subject) continue;
    if (/^[a-z]+(?:\([^)]+\))?!:/i.test(subject) || /BREAKING[ -]CHANGE:/i.test(raw)) {
      return "major";
    }
    if (/^feat(?:\([^)]+\))?:/i.test(subject)) level = Math.max(level, 2);
    else if (/^(fix|perf|refactor|build|revert)(?:\([^)]+\))?:/i.test(subject)) level = Math.max(level, 1);
  }
  return ["none", "patch", "minor"][level];
}

export function latestVersionTag(tags) {
  return tags.filter(tag => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    .sort((a, b) => {
      const aa = parseVersion(a), bb = parseVersion(b);
      return bb[0] - aa[0] || bb[1] - aa[1] || bb[2] - aa[2];
    })[0] ?? null;
}

export function recommendRelease({ current, tags, plannedVersion, messages }) {
  parseVersion(current);
  const tag = latestVersionTag(tags);
  // A prepared public release must be completed before any next version is proposed.
  if (plannedVersion && !tags.includes(plannedVersion)) return "none";
  if (!tag) return "current";
  if (tag !== current) {
    throw new Error("Latest published tag and manifest version differ: " + tag + " vs " + current);
  }
  return inferReleaseBump(messages);
}

function main() {
  const current = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version;
  const plannedVersion = fs.existsSync(".release-plan.json")
    ? JSON.parse(fs.readFileSync(".release-plan.json", "utf8")).version : null;
  const tags = git("tag", "--list").split("\n").filter(Boolean);
  const latest = latestVersionTag(tags);
  const messages = latest
    ? git("log", latest + "..HEAD", "--no-merges", "--format=%B%x00", "--", ".", ":(exclude)landing/**")
      .split("\0").filter(Boolean)
    : [];
  process.stdout.write(recommendRelease({ current, plannedVersion, tags, messages }) + "\n");
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  try { main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
