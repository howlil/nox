import { readFileSync } from "node:fs";

/** Read source CSS in exactly the order declared by the Obsidian entry stylesheet. */
export function noxCssSource(): string {
  const entry = readFileSync("styles.css", "utf8");
  const imports = [...entry.matchAll(/@import "\.\/styles\/([\w-]+\.css)";/g)]
    .map(match => match[1]);
  if (imports.length !== 14) throw new Error("NOX CSS source composition is incomplete.");
  return imports.map(filename => readFileSync("styles/" + filename, "utf8")).join("");
}
