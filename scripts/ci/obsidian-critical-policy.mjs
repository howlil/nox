import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Small, blocking source proof for Community Directory review P0 rules.
// The broad community scanner is complementary, not a substitute for this gate.
const problematicName = /\b(?:settings?|options?)\b/i;
const redundantPluginHeading = /^nox$/i;
const method = (node, name) => ts.isCallExpression(node)
  && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name;

function literalName(node) {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

function problematic(text) {
  return problematicName.test(text) || redundantPluginHeading.test(text.trim());
}

export function findSettingsHeadingViolations(content, filename = "SettingsTab.ts") {
  const sf = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];
  const namedVariables = new Map();
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && node.initializer && method(node.initializer, "setName")) {
      const name = literalName(node.initializer.arguments[0]);
      if (name !== null) namedVariables.set(node.name.text, name);
    }
    if (method(node, "createEl") && /^h[1-6]$/i.test(literalName(node.arguments[0]) ?? "")) {
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push({ filename, line: pos.line + 1, rule: "manual-html-heading",
        message: "HTML heading must use native Obsidian Setting.setHeading()." });
    }
    if (method(node, "setHeading")) {
      const receiver = node.expression.expression;
      let name = null;
      if (method(receiver, "setName")) name = literalName(receiver.arguments[0]);
      else if (ts.isIdentifier(receiver)) name = namedVariables.get(receiver.text) ?? null;
      if (name !== null && problematic(name)) {
        const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        violations.push({ filename, line: pos.line + 1, rule: "problematic-settings-heading",
          message: "Do not use 'settings', 'options', or plugin name as a settings heading." });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = process.argv.slice(2);
  const files = inputs.length ? inputs : ["src/settings/SettingsTab.ts"];
  const violations = files.flatMap(filename => findSettingsHeadingViolations(readFileSync(filename, "utf8"), filename));
  for (const v of violations) {
    console.error("::error file=" + v.filename + ",line=" + v.line +
      "::Obsidian " + v.rule + ": " + v.message);
  }
  if (violations.length) process.exitCode = 1;
  else console.log("Obsidian settings heading Community policy passed.");
}
