import fs from "node:fs";
import path from "node:path";
const required = ["README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
  "docs/README.md", "docs/GETTING_STARTED.md", "docs/PROVIDERS.md",
  "docs/TROUBLESHOOTING.md", "docs/RELEASING.md"];
for (const f of required) if (!fs.existsSync(f)) throw new Error("Missing required public document: " + f);
const errors = [];
// Enforce navigability of public docs, not historical internal design notes.
for (const filename of required.filter(f => f.endsWith(".md"))) {
  const content = fs.readFileSync(filename, "utf8");
  if (!content.trimStart().startsWith("# ")) errors.push(filename + ": missing H1");
  const regex = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  for (const [, raw] of content.matchAll(regex)) {
    const target = raw.trim().split(/\s+"/)[0].split("#")[0].replace(/^<|>$/g, "");
    if (!target || /^(https?:|mailto:|data:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(filename), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) errors.push(filename + ": broken link " + raw);
  }
}
if (errors.length) {
  console.error("Public documentation checks failed:\n" + errors.join("\n"));
  process.exitCode = 1;
} else console.log("Public docs present and local navigation links valid.");
