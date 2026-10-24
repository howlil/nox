import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Resolve the compiler from the repository workspace, not the temporary esbuild
// test bundle location. Avoid bundling the multi-megabyte TypeScript compiler.
const loadWorkspaceDependency = createRequire(resolve(process.cwd(), "package.json"));
const ts = loadWorkspaceDependency("typescript");

const SOURCE_ROOT = "src";
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

function normalizedPath(file) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

function location(sourceFile, node) {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  return line;
}

function isLiteral(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

export function extractImports(filename, source) {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = [];
  const dynamic = [];
  const add = (node, literal, kind) => {
    const specifier = isLiteral(literal);
    if (specifier !== null) {
      imports.push({ specifier, kind, line: location(sf, node) });
    } else {
      dynamic.push({ path: filename, line: location(sf, node), kind });
    }
  };
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly = Boolean(clause?.isTypeOnly ||
        (!clause?.name && named && ts.isNamedImports(named) &&
          named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly)));
      add(node, node.moduleSpecifier, typeOnly ? "type" : "runtime");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const clause = node.exportClause;
      const typeOnly = Boolean(node.isTypeOnly ||
        (clause && ts.isNamedExports(clause) && clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly)));
      add(node, node.moduleSpecifier, typeOnly ? "type" : "runtime");
    } else if (ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, node.isTypeOnly ? "type" : "runtime");
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      add(node, ts.isLiteralTypeNode(argument) ? argument.literal : undefined, "type");
    } else if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      add(node, node.arguments[0], "runtime");
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { imports, dynamic };
}

function resolveLocal(from, specifier, known) {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => posix.join(base, "index" + ext))];
  if (base.endsWith(".js") || base.endsWith(".mjs") || base.endsWith(".cjs")) {
    const withoutExt = base.slice(0, base.lastIndexOf("."));
    candidates.push(...EXTENSIONS.map((ext) => withoutExt + ext));
  }
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

function ownerOf(filename) {
  if (filename.startsWith("packages/core/src/domain/")) return "domain";
  const parts = filename.split("/");
  if (parts.length < 3 || parts[0] !== SOURCE_ROOT) return "(root)";
  // Feature-private collaborators are not one giant 'features' owner.
  // Measure cross-capability dependencies at their actual package boundary.
  if (parts[1] === "features" && parts.length >= 5) {
    return parts.slice(1, 4).join("/");
  }
  return parts[1];
}

function stronglyConnectedComponents(paths, edges) {
  const adjacent = new Map(paths.map((path) => [path, new Set()]));
  for (const edge of edges) adjacent.get(edge.from)?.add(edge.to);
  let sequence = 0;
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), cycles = [];
  function visit(current) {
    indices.set(current, sequence);
    low.set(current, sequence++);
    stack.push(current);
    active.add(current);
    for (const next of [...(adjacent.get(current) ?? [])].sort()) {
      if (!indices.has(next)) {
        visit(next);
        low.set(current, Math.min(low.get(current), low.get(next)));
      } else if (active.has(next)) {
        low.set(current, Math.min(low.get(current), indices.get(next)));
      }
    }
    if (low.get(current) === indices.get(current)) {
      const component = [];
      let node;
      do {
        node = stack.pop();
        active.delete(node);
        component.push(node);
      } while (node !== current);
      if (component.length > 1 || adjacent.get(current)?.has(current)) {
        cycles.push(component.sort());
      }
    }
  }
  for (const path of paths) if (!indices.has(path)) visit(path);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

export function analyzeSources(files) {
  const inputs = files.map((file) => ({ path: normalizedPath(file.path), source: file.source }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const paths = inputs.map((file) => file.path);
  const known = new Set(paths);
  if (known.size !== paths.length) throw new Error("Duplicate source paths in architecture graph");
  const edges = [], external = [], unresolved = [], dynamic = [];
  const seenEdges = new Set();

  for (const file of inputs) {
    const parsed = extractImports(file.path, file.source);
    dynamic.push(...parsed.dynamic);
    for (const item of parsed.imports) {
      if (!item.specifier.startsWith(".")) {
        external.push({ from: file.path, module: item.specifier, kind: item.kind, line: item.line });
        continue;
      }
      const target = resolveLocal(file.path, item.specifier, known);
      if (!target) {
        unresolved.push({ from: file.path, specifier: item.specifier, line: item.line });
        continue;
      }
      const key = JSON.stringify([file.path, target, item.kind]);
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        edges.push({ from: file.path, to: target, kind: item.kind });
      }
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) ||
    a.kind.localeCompare(b.kind));
  external.sort((a, b) => a.from.localeCompare(b.from) || a.module.localeCompare(b.module));
  unresolved.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
  dynamic.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

  const crossing = new Map();
  const outgoing = new Map(paths.map((path) => [path, new Set()]));
  const incoming = new Map(paths.map((path) => [path, new Set()]));
  for (const edge of edges) {
    outgoing.get(edge.from).add(edge.to);
    incoming.get(edge.to).add(edge.from);
    const sourceOwner = ownerOf(edge.from), targetOwner = ownerOf(edge.to);
    if (sourceOwner !== targetOwner) {
      const key = sourceOwner + " -> " + targetOwner;
      crossing.set(key, (crossing.get(key) ?? 0) + 1);
    }
  }
  const hubs = paths.map((path) => ({
    path, owner: ownerOf(path),
    fanIn: incoming.get(path).size, fanOut: outgoing.get(path).size,
  })).sort((a, b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut) ||
    a.path.localeCompare(b.path));
  const cycles = stronglyConnectedComponents(paths, edges);
  const ownerEdges = [...crossing].map(([edge, count]) => ({ edge, count }))
    .sort((a, b) => b.count - a.count || a.edge.localeCompare(b.edge));
  return {
    summary: {
      files: paths.length,
      internalEdges: edges.length,
      runtimeEdges: edges.filter((edge) => edge.kind === "runtime").length,
      typeEdges: edges.filter((edge) => edge.kind === "type").length,
      crossOwnerEdges: ownerEdges.reduce((sum, edge) => sum + edge.count, 0),
      externalImports: external.length,
      unresolved: unresolved.length,
      dynamic: dynamic.length,
      cycles: cycles.length,
    },
    owners: [...new Set(paths.map(ownerOf))].sort().map((owner) => ({
      owner, files: paths.filter((path) => ownerOf(path) === owner).length,
    })),
    ownerEdges, hubs, cycles, unresolved, dynamic, edges, external,
  };
}

export function collectSources(root = process.cwd()) {
  const base = resolve(root, SOURCE_ROOT);
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        files.push({
          path: normalizedPath(relative(root, absolute).split(sep).join("/")),
          source: readFileSync(absolute, "utf8"),
        });
      }
    }
  }
  walk(base);
  const canonicalDomain = resolve(root, "packages/core/src/domain");
  if (existsSync(canonicalDomain)) walk(canonicalDomain);
  return files;
}

export function formatMarkdown(report) {
  const s = report.summary;
  const lines = [
    "# NOX architecture dependency baseline",
    "",
    "Metrics are derived from TypeScript AST imports, exports, literal dynamic imports and require calls.",
    "They describe dependencies, not proof that responsibilities or state ownership are correct.",
    "",
    "| Metric | Value |", "|---|---:|",
    ...Object.entries(s).map(([name, count]) => "| " + name + " | " + count + " |"),
    "",
    "## Module owners",
    "",
    "| Owner | Files |", "|---|---:|",
    ...report.owners.map((x) => "| " + x.owner + " | " + x.files + " |"),
    "",
    "## Cross-owner imports (top 20)",
    "",
    "| Direction | Edges |", "|---|---:|",
    ...report.ownerEdges.slice(0, 20).map((x) => "| " + x.edge + " | " + x.count + " |"),
    "",
    "## Highest coupling by unique fan-in + fan-out (top 15)",
    "",
    "| Source file | Fan-in | Fan-out |", "|---|---:|---:|",
    ...report.hubs.slice(0, 15).map((x) => "| " + x.path + " | " + x.fanIn + " | " + x.fanOut + " |"),
    "",
    "## Cycles (strongly connected components)",
    "",
    ...(report.cycles.length ? report.cycles.slice(0, 20).map((group) => "- " + group.join(" -> ")) : ["- None detected"]),
    "",
    "## Unresolved relative imports",
    "",
    ...(report.unresolved.length ? report.unresolved.slice(0, 30)
      .map((x) => "- " + x.from + ":" + x.line + " imports " + x.specifier) : ["- None detected"]),
    "",
    "## Dynamic expressions requiring manual review",
    "",
    ...(report.dynamic.length ? report.dynamic.slice(0, 30)
      .map((x) => "- " + x.path + ":" + x.line + " (" + x.kind + ")") : ["- None detected"]),
    "",
  ];
  return lines.join("\n");
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const format = process.argv.includes("--format=json") ? "json" : "markdown";
  const report = analyzeSources(collectSources());
  process.stdout.write((format === "json" ? JSON.stringify(report, null, 2) :
    formatMarkdown(report)) + "\n");
  if (process.argv.includes("--check") && (report.unresolved.length || report.dynamic.length)) {
    process.exitCode = 1;
  }
}
