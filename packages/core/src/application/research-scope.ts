/** Parse research scope without accessing the Obsidian runtime. */
import type { AgentContext, ResearchScope } from "../types";

export type RequestedResearchScope =
  | { kind: "vault" }
  | { kind: "selected" }
  | { kind: "folder"; path: string };

export function parseResearchRequest(prompt: string):
  { query: string; scope: RequestedResearchScope } | null {
  if (!/^\/research(?:\s|$)/i.test(prompt)) return null;
  let rest = prompt.replace(/^\/research\s*/i, "").trim();
  const scopeMatch = /^--scope=(vault|selected|folder:(?:"([^"]+)"|'([^']+)'|(\S+)))(?:\s+|$)/i.exec(rest);
  let scope: RequestedResearchScope = { kind: "vault" };
  if (scopeMatch) {
    const key = scopeMatch[1].toLowerCase();
    scope = key === "selected" ? { kind: "selected" } :
      key === "vault" ? { kind: "vault" } :
      { kind: "folder", path: (scopeMatch[2] ?? scopeMatch[3] ?? scopeMatch[4] ?? "").trim() };
    rest = rest.slice(scopeMatch[0].length).trim();
  }
  return { query: rest, scope };
}

/** Active source-bound programs always override caller-requested broader scopes. */
export function resolveResearchScope(requested: RequestedResearchScope, options: {
  sourceBoundPaths?: string[];
  selectedPaths: string[];
}): ResearchScope {
  if (options.sourceBoundPaths) {
    return { kind: "selected", paths: [...new Set(options.sourceBoundPaths)] };
  }
  if (requested.kind === "selected") {
    const paths = [...new Set(options.selectedPaths.filter(Boolean))];
    if (!paths.length) throw new Error("Select a note before searching selected sources.");
    return { kind: "selected", paths };
  }
  if (requested.kind === "folder") {
    const path = requested.path.replace(/^\/+|\/+$/g, "");
    if (!path || path.split("/").some(part => part === ".." || part === ".")) {
      throw new Error("Choose a valid vault-relative research folder.");
    }
    return { kind: "folder", path };
  }
  return { kind: "vault" };
}

/** Scope is an authority on provider-bound content, not a retrieval preference. */
export function constrainResearchContext(
  sources: readonly AgentContext[], scope: ResearchScope,
): AgentContext[] {
  if (scope.kind === "vault") return [...sources];
  const paths = scope.kind === "selected" ? new Set(scope.paths) : undefined;
  return sources.filter(source => scope.kind === "selected"
    ? paths!.has(source.file)
    : source.file.startsWith(scope.path + "/"));
}
