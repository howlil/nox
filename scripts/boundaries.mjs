import path from "node:path";

/**
 * Fail closed for unknown owners. Cross-boundary imports are deliberate
 * exceptions, not a blanket ability to reach into every sibling folder.
 */
const ALLOWED_OWNERS = {
  application: ["application", "domain", "agent", "context", "session", "types", "persistence"],
  agent: ["agent", "domain", "types"],
  chat: ["chat", "application", "domain", "context", "types"],
  context: ["context", "types"],
  domain: ["domain"],
  mutation: ["mutation", "domain", "types"],
  persistence: ["persistence", "domain", "types"],
  session: ["session", "persistence", "domain", "types"],
  settings: ["settings"],
};
const ROOT_FILES = new Set(["src/main.ts", "src/types.ts"]);
const IMPORTS = /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)(["'])([^"']+)\1/g;

function isApprovedEdge(from, to) {
  const owner = from.split("/")[1];
  const target = to === "src/types.ts" ? "types" : to.split("/")[1];
  if (from === "src/types.ts") return to === "src/session/transcript-types.ts";
  if (from === "src/main.ts") return true;
  if (!ALLOWED_OWNERS[owner]?.includes(target)) return false;

  if (owner === "application") {
    // Exception: normalized parser/port, session transcript shape, and shared
    // persistence failure contract. No adapter, controller or repository.
    if (target === "agent") {
      return to === "src/agent/AgentRuntime.ts" ||
        to === "src/agent/StructuredStreamParser.ts";
    }
    if (target === "context") return to === "src/context/context-types.ts";
    if (target === "session") return to === "src/session/transcript-types.ts";
    if (target === "persistence") return to === "src/persistence/PersistenceError.ts";
  }
  if (owner === "chat" && target === "context") return to === "src/context/context-types.ts";
  if (owner === "session" && target === "persistence") {
    return to === "src/persistence/PluginDataRepository.ts" ||
      to === "src/persistence/PersistenceError.ts";
  }
  return true;
}

/** The same validator runs in CI and in focused architecture regression tests. */
export function validateArchitecture(files) {
  const issues = [];
  const present = new Set(files.map((entry) => entry.path));
  for (const { path: filename, source } of files) {
    if (!filename.startsWith("src/") || !filename.endsWith(".ts")) continue;
    const parts = filename.split("/");
    const owner = parts[1];
    if (!ROOT_FILES.has(filename) && (!ALLOWED_OWNERS[owner] || parts.length < 3)) {
      issues.push(`${filename}: unrecognized module owner; place code in a documented boundary`);
      continue;
    }
    if (owner === "learning") {
      issues.push(`${filename}: legacy src/learning/ is not an owner`);
      continue;
    }
    for (const match of source.matchAll(IMPORTS)) {
      const specifier = match[2];
      if (specifier.startsWith(".")) {
        const basename = path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier));
        const target = present.has(basename) ? basename
          : present.has(basename + ".ts") ? basename + ".ts"
          : present.has(basename + "/index.ts") ? basename + "/index.ts"
          : basename + ".ts";
        if (!present.has(target)) {
          issues.push(`${filename}: unresolved import "${specifier}" (resolved as ${target})`);
          continue;
        }
        if (!isApprovedEdge(filename, target)) {
          issues.push(`${filename}: forbidden dependency -> ${target}`);
        }
      } else if (owner === "domain") {
        issues.push(`${filename}: domain must not import runtime/external module "${specifier}"`);
      } else if (owner === "application" && specifier === "obsidian") {
        issues.push(`${filename}: application must not import Obsidian APIs`);
      } else if (owner === "agent" && ["child_process", "fs", "os", "path"].includes(specifier)
        && filename !== "src/agent/AgyAdapter.ts") {
        issues.push(`${filename}: provider/process I/O belongs in AgyAdapter`);
      }
    }
  }
  return issues;
}
