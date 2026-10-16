import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Mandatory local P0 gate. The full Community scanner runs separately.
export function findManualSettingsHeadings(content, filename = "SettingsTab.ts") {
  const sf = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "createEl") {
      const [first] = node.arguments;
      if (first && ts.isStringLiteralLike(first) && /^h[1-6]$/i.test(first.text)) {
        const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        violations.push({ filename, line: pos.line + 1, tag: first.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  const inputs = files.length ? files : ["src/settings/SettingsTab.ts"];
  const violations = inputs.flatMap(filename => findManualSettingsHeadings(readFileSync(filename, "utf8"), filename));
  for (const v of violations) {
    console.error("::error file=" + v.filename + ",line=" + v.line +
      "::Obsidian settings heading " + v.tag + " must use new Setting(...).setName(...).setHeading()");
  }
  if (violations.length) process.exitCode = 1;
  else console.log("Obsidian P0 settings heading AST policy passed.");
}
