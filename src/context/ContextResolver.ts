import { AgentContext, type ResearchScope } from "../types";
import type { ObsidianContext } from "./ObsidianContext";
import {
  ContextDocument,
  ExplicitContextRef,
  LearningContext,
} from "./context-types";
import type { ResearchResult } from "./LocalResearch";

/**
 * Single source of truth for context shown in the UI and sent to the agent.
 *
 * Explicit vault notes remain references until turn start so the latest note
 * buffer is resolved immediately before the agent request is built.
 */
export class ContextResolver {
  constructor(private readonly obsidian: ObsidianContext) {}

  async resolve(
    explicit: ExplicitContextRef[] = [],
  ): Promise<LearningContext> {
    const selection = this.obsidian.getSelection();
    const activeNote = await this.obsidian.getCurrentNote();

    const explicitDocs: ContextDocument[] = [];

    for (const ref of explicit) {
      if (ref.kind === "attachment") {
        explicitDocs.push({
          type: "note",
          path: `attachment/${ref.name}`,
          content: ref.content,
          source: "explicit",
        });
        continue;
      }

      const note = await this.obsidian.loadNote(ref.path);
      if (!note) {
        throw new Error(
          `Explicit context note no longer exists: ${ref.path}`,
        );
      }

      explicitDocs.push({
        type: "note",
        path: note.file,
        content: note.content,
        source: "explicit",
      });
    }

    return {
      selection: selection ?? undefined,
      activeNote: activeNote
        ? {
            path: activeNote.file,
            content: activeNote.content,
          }
        : undefined,
      explicit: explicitDocs,
    };
  }

  searchKnowledge(query: string, options?: { allowedPaths?: string[]; scope?: ResearchScope; limit?: number }): Promise<ResearchResult> {
    return this.obsidian.searchKnowledge(query, options);
  }

  searchNotes(
    query: string,
    limit = 8,
  ): Array<{ path: string; name: string }> {
    return this.obsidian.searchNotes(query, limit);
  }

  toAgentContext(context: LearningContext): AgentContext[] {
    const result: AgentContext[] = [];

    if (context.selection) {
      result.push({
        type: "selection",
        file: context.selection.file,
        content: context.selection.content,
      });
    } else if (context.activeNote) {
      result.push({
        type: "note",
        file: context.activeNote.path,
        content: context.activeNote.content,
      });
    }

    const seen = new Map<string, Set<string>>();
    for (const existing of result) {
      seen.set(existing.type + "\0" + existing.file, new Set([existing.content]));
    }
    for (const item of context.explicit) {
      const key = item.type + "\0" + item.path;
      const contents = seen.get(key) ?? new Set<string>();
      if (contents.has(item.content)) continue;
      contents.add(item.content);
      seen.set(key, contents);
      result.push({
        type: item.type,
        file: item.path,
        content: item.content,
      });
    }

    return result;
  }
}
