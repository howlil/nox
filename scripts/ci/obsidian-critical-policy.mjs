import { readFileSync, readdirSync } from "node:fs";
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

/**
 * Fail closed on source-level inline style mutations rejected by the
 * Obsidian Community Scanner: obsidianmd/no-static-styles-assignment.
 * Prefer CSS classes, setCssProps or setCssStyles (all are Obsidian APIs).
 */
export function findDirectStyleViolations(content, filename = "source.ts") {
  const sf = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const issues = [];
  const isStyle = node =>
    (ts.isPropertyAccessExpression(node) && node.name.text === "style") ||
    (ts.isElementAccessExpression(node) && literalName(node.argumentExpression) === "style");
  const isStyleMember = node =>
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    isStyle(node.expression);
  const assignment = new Set([
    ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ]);
  const emit = node => {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    issues.push({ filename, line: pos.line + 1, rule: "no-static-styles-assignment",
      message: "Use CSS classes, setCssProps or setCssStyles instead of element.style mutation." });
  };
  const visit = node => {
    if (ts.isBinaryExpression(node) && assignment.has(node.operatorToken.kind) &&
        isStyleMember(node.left)) emit(node);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ["setProperty", "removeProperty"].includes(node.expression.name.text) &&
        isStyle(node.expression.expression)) emit(node);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        isStyleMember(node.operand)) emit(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return issues;
}

function typescriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const filename = directory + "/" + item.name;
    if (item.isDirectory()) return typescriptFiles(filename);
    return item.isFile() && filename.endsWith(".ts") ? [filename] : [];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = process.argv.slice(2);
  const files = inputs.length ? inputs : typescriptFiles("src");
  const violations = files.flatMap(filename => {
    const source = readFileSync(filename, "utf8");
    return [
      ...findDirectStyleViolations(source, filename),
      ...(filename.endsWith("SettingsTab.ts") ? findSettingsHeadingViolations(source, filename) : []),
    ];
  });
  for (const v of violations) {
    console.error("::error file=" + v.filename + ",line=" + v.line +
      "::Obsidian " + v.rule + ": " + v.message);
  }
  if (violations.length) process.exitCode = 1;
  else console.log("Obsidian Community policy passed: settings headings and no direct styles.");
}
