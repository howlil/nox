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
const FEATURE_PACKAGES = new Set(["conversation/turn", "conversation/view", "learning/program", "learning/onboarding", "learning/view", "practice/view"]);
const IMPORTS = /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)(["'])([^"']+)\1/g;

function isApprovedFeatureEdge(from, to) {
  const fromPackage = from.split("/").slice(2, 4).join("/");
  const toPackage = to.split("/").slice(2, 4).join("/");
  // Preserve root stable public facades; only they may reach capability-owned internals.
  if (to.startsWith("src/features/") && !from.startsWith("src/features/")) {
    if (from === "src/application/RunLearningTurn.ts") return toPackage === "conversation/turn";
    if (from === "src/application/LearningProgramOrchestrator.ts") return toPackage === "learning/program";
    if (from === "src/chat/ChatView.ts") return toPackage === "conversation/view" || toPackage === "practice/view" || toPackage === "learning/view";
    if (from === "src/chat/response-visuals.ts") return toPackage === "conversation/view";
    if (from === "src/chat/onboarding-flow.ts") return toPackage === "learning/onboarding";
    return false;
  }
  if (!FEATURE_PACKAGES.has(fromPackage)) return false;
  if (to.startsWith("src/features/")) return toPackage === fromPackage;
  if (to.startsWith("src/domain/")) {
    if (fromPackage === "learning/onboarding") {
      return ["src/domain/onboarding/types.ts", "src/domain/learning-program/types.ts"].includes(to);
    }
    if (fromPackage === "practice/view") return to.startsWith("src/domain/practice/");
    if (fromPackage === "learning/view") return to === "src/domain/activity/aggregation.ts";
    return fromPackage !== "conversation/view";
  }
  if (to === "src/types.ts") return true;
  if (fromPackage === "conversation/view") {
    return ["src/chat/history-list.ts", "src/chat/menu.ts",
      "src/chat/motion.ts", "src/chat/popover.ts",
      "src/chat/primitives.ts", "src/chat/code-answer-editor.ts",
      "src/chat/response-spec.ts", "src/chat/message-actions.ts"].includes(to);
  }
  if (fromPackage === "practice/view") {
    return ["src/chat/primitives.ts", "src/chat/code-answer-editor.ts"].includes(to);
  }
  if (fromPackage === "learning/view") {
    return ["src/chat/primitives.ts", "src/application/learning-types.ts"].includes(to);
  }
  if (fromPackage === "conversation/turn") {
    return ["src/application/learning-types.ts", "src/application/ports.ts",
      "src/application/reply-context.ts", "src/agent/StructuredStreamParser.ts",
      "src/context/context-types.ts", "src/context/ContextBudget.ts",
      "src/persistence/PersistenceError.ts"].includes(to);
  }
  if (fromPackage === "learning/program") {
    return ["src/application/ports.ts", "src/agent/AgentRuntime.ts"].includes(to);
  }
  if (fromPackage === "learning/onboarding") return false;
  return false;
}

function isApprovedEdge(from, to) {
  const owner = from.split("/")[1];
  const target = to === "src/types.ts" ? "types" : to.split("/")[1];
  if (from === "src/types.ts") return to === "src/session/transcript-types.ts";
  if (from === "src/main.ts") return true;
  if (from.startsWith("src/features/") || to.startsWith("src/features/")) return isApprovedFeatureEdge(from, to);
  // M4: the context application-facing resolver consumes a structural port,
  // never the concrete Obsidian adapter or any host-specific implementation.
  if (from === "src/context/ContextResolver.ts" &&
      to === "src/context/ObsidianContext.ts") return false;

  if (!ALLOWED_OWNERS[owner]?.includes(target)) return false;

  // M1: the Obsidian view must ask the application facade to interpret
  // business commands/scopes, never import their policy parsers directly.
  if ((from === "src/chat/ChatView.ts" || from === "src/chat/chat-state.ts") &&
      (to === "src/domain/practice/learning-scope.ts" ||
       to === "src/domain/learning-program/commands.ts")) return false;

  if (owner === "application") {
    // Exception: normalized parser/port, session transcript shape, and shared
    // persistence failure contract. No adapter, controller or repository.
    if (target === "agent") {
      return to === "src/agent/AgentRuntime.ts" ||
        to === "src/agent/StructuredStreamParser.ts";
    }
    if (target === "context") return to === "src/context/context-types.ts" || to === "src/context/ContextBudget.ts" || to === "src/context/LocalResearch.ts";
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
    if (owner === "features" && (parts.length < 5 ||
        !FEATURE_PACKAGES.has(parts.slice(2, 4).join("/")))) {
      issues.push(`${filename}: unknown feature package; use a documented capability owner`);
      continue;
    }
    if (!ROOT_FILES.has(filename) && owner !== "features" && (!ALLOWED_OWNERS[owner] || parts.length < 3)) {
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
      } else if (owner === "features" && (specifier === "obsidian" ||
          ["child_process", "fs", "os", "path"].includes(specifier))) {
        issues.push(`${filename}: feature module cannot import host/OS implementation "${specifier}"`);
      } else if (owner === "application" && specifier === "obsidian") {
        issues.push(`${filename}: application must not import Obsidian APIs`);
      } else if (owner === "agent" && ["child_process", "fs", "os", "path"].includes(specifier)
        && filename !== "src/agent/AgyAdapter.ts" && filename !== "src/agent/CodexAdapter.ts" && filename !== "src/agent/ChatGptAuth.ts") {
        issues.push(`${filename}: provider/process I/O belongs in a concrete agent adapter`);
      }
    }
  }
  return issues;
}
