import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read source CSS in exactly the order declared by the Obsidian entry stylesheet. */
export function noxCssSource(root = process.cwd()): string {
  const entry = readFileSync(join(root, "styles.css"), "utf8");
  const imports = [...entry.matchAll(/@import "\.\/styles\/([\w-]+\.css)";/g)]
    .map(match => match[1]);
  if (imports.length !== 14) throw new Error("NOX CSS source composition is incomplete.");
  return imports.map(filename => readFileSync(join(root, "styles", filename), "utf8")
    .replace(/\r\n/g, "\n")).join("");
}
