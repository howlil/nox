import type { ResearchScope } from "../types";
import type { ResearchResult } from "./LocalResearch";

/**
 * Host-neutral capability required by ContextResolver.
 * ObsidianContext is a concrete implementation at composition root only.
 * Note text comes from current editor buffers when open, not stale vault cache.
 */
export interface ContextSourcePort {
  /** Read-only filename metadata for onboarding, without opening editor/vault contents. */
  getActiveNotePath?(): string | undefined;
  getSelection(): { file: string; content: string } | null;
  getCurrentNote(): Promise<{ file: string; content: string } | null>;
  loadNote(path: string): Promise<{ file: string; content: string } | null>;
  searchNotes(query: string, limit?: number): Array<{ path: string; name: string }>;
  searchKnowledge(query: string, options?: {
    allowedPaths?: string[];
    scope?: ResearchScope;
    limit?: number;
  }): Promise<ResearchResult>;
}
