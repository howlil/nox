import { App, TFile } from "obsidian";
import { LearningPolicy } from "../../packages/core/src/context/context-types";

/**
 * Loads vault-level learning policy from AGENTS.md.
 *
 * The raw file is intentionally preserved as policy text. We only parse policy
 * into structured fields when application behavior truly needs those fields.
 */
const OBSIDIAN_HOST_INSTRUCTIONS = [
  "This host is an Obsidian vault. The user may provide selected notes, links, and AGENTS.md as contextual learning material.",
  "In research answers cite supplied note paths using Obsidian [[note path]] links, including a section or line when available.",
  "HTML previews appear inside potentially narrow Obsidian panes; keep content naturally sized and avoid nested scroll regions.",
].join("\n");

export class PolicyLoader {
  private readonly skillCache = new Map<string, { mtime: number; size: number; content: string }>();
  private cached:
    | {
        mtime: number;
        policy: LearningPolicy;
      }
    | undefined;

  constructor(private readonly app: App) {}

  async loadSkill(kind: "assessment" | "teaching" | "review" | "research"):
    Promise<{ path: string; content: string } | null> {
    const path = `00-learning-os/skills/learning-${kind}/SKILL.md`;
    const file = this.app.vault.getFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      this.skillCache.delete(path);
      return null;
    }
    if (file.stat.size > 12_000) throw new Error("Learning skill exceeds 12 KB limit: " + path);
    const cached = this.skillCache.get(path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
      return { path, content: cached.content };
    }
    const content = await this.app.vault.cachedRead(file);
    if (new TextEncoder().encode(content).length > 12_000) {
      throw new Error("Learning skill exceeds 12 KB limit: " + path);
    }
    this.skillCache.set(path, { mtime: file.stat.mtime, size: file.stat.size, content });
    return { path, content };
  }

  async load(): Promise<LearningPolicy> {
    const file = this.app.vault.getFileByPath("AGENTS.md");

    if (!file || !(file instanceof TFile)) {
      this.cached = undefined;
      return {
        path: "AGENTS.md",
        rawInstructions: "",
        hostInstructions: OBSIDIAN_HOST_INSTRUCTIONS,
      };
    }

    if (this.cached?.mtime === file.stat.mtime) {
      return this.cached.policy;
    }

    const policy: LearningPolicy = {
      path: file.path,
      rawInstructions: await this.app.vault.cachedRead(file),
      hostInstructions: OBSIDIAN_HOST_INSTRUCTIONS,
    };

    this.cached = {
      mtime: file.stat.mtime,
      policy,
    };

    return policy;
  }
}
