import path from "node:path";
import { createRequire } from "node:module";

// Match scripts/architecture-graph.mjs: resolve TypeScript from the workspace,
// not from the temporary bundled test location.
const loadWorkspaceDependency = createRequire(path.resolve(process.cwd(), "package.json"));
const ts = loadWorkspaceDependency("typescript");

/** M10.2: every physically extracted package module is subject to portable
 * TypeScript AST checks. Package-owned session contracts are checked at canonical paths; retained legacy contracts remain guarded. */
export const PORTABLE_CONTRACT_FILES = Object.freeze([
  "src/application/learning-state-projection.ts",
  "src/application/learning-types.ts",
  "src/application/ports.ts",
  "packages/core/src/context/ContextBudget.ts",
  "src/context/ContextResolver.ts",
  "packages/core/src/context/ContextSourcePort.ts",
  "src/context/LocalResearch.ts",
  "src/context/context-types.ts",
  "src/persistence/learning-state-schema.ts",
  "src/session/SessionController.ts",
  "src/session/SessionStore.ts",
  "packages/core/src/session/message-types.ts",
  "packages/core/src/session/transcript-part-types.ts",
  "packages/core/src/session/transcript-schema.ts",
  "packages/core/src/session/transcript-types.ts",
  "src/types.ts",
]);

const CONTRACTS = new Set(PORTABLE_CONTRACT_FILES);
const HOST_GLOBALS = new Set([
  "window", "document", "navigator", "localStorage", "sessionStorage",
  "process", "Buffer", "require", "__dirname", "__filename", "Deno", "Bun",
  "HTMLElement", "Document", "Window", "NodeJS",
]);

export function isPortableSource(filename) {
  return (filename.startsWith("src/domain/") ||
    filename.startsWith("packages/core/src/")) && filename.endsWith(".ts") ||
    CONTRACTS.has(filename);
}

function sourceLocation(file, node) {
  const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return `${file.fileName}:${line + 1}:${character + 1}`;
}

function isHostGlobalIdentifier(node) {
  const parent = node.parent;
  // Object keys and ordinary .properties may share a spelling with globals.
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return ts.isIdentifier(parent.expression) && parent.expression.text === "globalThis";
  }
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) ||
      ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) &&
      parent.name === node) return false;
  return true;
}

/** Inspect source boundaries without executing or evaluating source files. */
export function validatePortableBoundaries(files, { requireManifest = false } = {}) {
  const present = new Set(files.map(file => file.path));
  const issues = [];

  if (requireManifest) {
    for (const filename of PORTABLE_CONTRACT_FILES) {
      if (!present.has(filename)) issues.push(`${filename}: declared portable contract file is missing`);
    }
  }

  function validateModule(sourceFile, node, specifier) {
    const where = sourceLocation(sourceFile, node);
    if (typeof specifier !== "string") {
      issues.push(`${where}: dynamic module specifier is forbidden in portable core`);
      return;
    }
    if (!specifier.startsWith(".")) {
      issues.push(`${where}: portable module cannot import host/runtime package "${specifier}"`);
      return;
    }
    const name = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile.fileName), specifier));
    const candidates = [name, name + ".ts", name + "/index.ts"];
    const resolved = candidates.find(target => present.has(target));
    if (!resolved) {
      issues.push(`${where}: unresolved portable dependency "${specifier}"`);
    } else if (!isPortableSource(resolved)) {
      issues.push(`${where}: portable module cannot depend on nonportable source ${resolved}`);
    }
  }

  for (const { path: filename, source } of files) {
    if (!isPortableSource(filename)) continue;
    const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    // Triple-slash directives also import ambient host contracts. They do not
    // appear as ordinary import declarations in the TypeScript AST.
    for (const reference of [
      ...sourceFile.referencedFiles,
      ...sourceFile.typeReferenceDirectives,
      ...sourceFile.libReferenceDirectives,
    ]) {
      const line = sourceFile.getLineAndCharacterOfPosition(reference.pos).line + 1;
      issues.push(`${filename}:${line}: portable module cannot include triple-slash reference "${reference.fileName}"`);
    }
    for (const problem of sourceFile.parseDiagnostics) {
      issues.push(`${filename}:${sourceFile.getLineAndCharacterOfPosition(problem.start ?? 0).line + 1}: invalid portable TypeScript syntax`);
    }
    function inspect(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          validateModule(sourceFile, node, ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text : undefined);
        }
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        validateModule(sourceFile, node, expression && ts.isStringLiteral(expression)
          ? expression.text : undefined);
      } else if (ts.isImportTypeNode(node)) {
        const arg = node.argument;
        validateModule(sourceFile, node, ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)
          ? arg.literal.text : undefined);
      } else if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            ts.isIdentifier(node.expression) && node.expression.text === "require") {
          const arg = node.arguments[0];
          validateModule(sourceFile, node, arg && ts.isStringLiteral(arg) ? arg.text : undefined);
        }
      } else if (ts.isElementAccessExpression(node) &&
          ts.isIdentifier(node.expression) && node.expression.text === "globalThis" &&
          node.argumentExpression && ts.isStringLiteral(node.argumentExpression) &&
          HOST_GLOBALS.has(node.argumentExpression.text)) {
        issues.push(`${sourceLocation(sourceFile, node)}: portable module accesses host global globalThis["${node.argumentExpression.text}"]`);
      } else if (ts.isIdentifier(node) && HOST_GLOBALS.has(node.text) &&
          isHostGlobalIdentifier(node)) {
        issues.push(`${sourceLocation(sourceFile, node)}: portable module references host-specific global "${node.text}"`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(sourceFile);
  }
  return [...new Set(issues)];
}
