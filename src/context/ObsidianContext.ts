import {
  App,
  MarkdownView,
  Plugin,
  TFile,
} from "obsidian";
import { LocalResearchIndex, type ResearchResult } from "./LocalResearch";

/**
 * Resolves learning context from the most recent Markdown editor rather than
 * blindly trusting workspace.activeLeaf. The Nox sidebar can own focus
 * without losing the learner's note/selection.
 */
export class ObsidianContext {
  private lastMarkdownView: MarkdownView | null = null;
  private readonly researchIndex = new LocalResearchIndex();
  private readonly indexedRevisions = new Map<string, string>();

  constructor(
    private readonly app: App,
    plugin: Plugin,
  ) {
    this.captureCurrentMarkdownView();

    plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.lastMarkdownView = leaf.view;
        }
      }),
    );

    plugin.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.captureCurrentMarkdownView();
      }),
    );
    // Keep the index derived; editor-buffer freshness is separately checked
    // on each query because unsaved changes do not emit vault modifications.
    plugin.registerEvent(this.app.vault.on("modify", file => this.invalidateResearch(file.path)));
    plugin.registerEvent(this.app.vault.on("delete", file => this.invalidateResearch(file.path)));
    plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.invalidateResearch(oldPath);
      this.invalidateResearch(file.path);
    }));
    plugin.registerEvent(this.app.metadataCache.on("changed", file => this.invalidateResearch(file.path)));
  }

  getSelection(): { file: string; content: string } | null {
    const view = this.getRelevantMarkdownView();
    const file = view?.file;
    const selection = view?.editor.getSelection() ?? "";

    if (!file || !selection) return null;

    return {
      file: file.path,
      content: selection,
    };
  }

  async getCurrentNote(): Promise<{ file: string; content: string } | null> {
    const view = this.getRelevantMarkdownView();

    if (view?.file) {
      return {
        file: view.file.path,
        content: view.editor.getValue(),
      };
    }

    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile)) return null;

    return {
      file: file.path,
      content: await this.app.vault.cachedRead(file),
    };
  }

  searchNotes(
    query: string,
    limit = 8,
  ): Array<{ path: string; name: string }> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    return this.app.vault
      .getMarkdownFiles()
      .map((file) => ({
        path: file.path,
        name: file.basename,
        score:
          file.basename.toLowerCase().startsWith(normalized)
            ? 0
            : file.path.toLowerCase().includes(normalized)
              ? 1
              : 2,
      }))
      .filter(
        (item) =>
          item.name.toLowerCase().includes(normalized) ||
          item.path.toLowerCase().includes(normalized),
      )
      .sort(
        (a, b) =>
          a.score - b.score || a.path.localeCompare(b.path),
      )
      .slice(0, limit)
      .map(({ path, name }) => ({ path, name }));
  }

  /**
   * Lazy and incremental: ordinary chat never pays for vault-wide indexing.
   * Cached revisions are checked at query time, including deleted notes.
   */
  async searchKnowledge(query: string, options: {
    allowedPaths?: string[];
    limit?: number;
  } = {}): Promise<ResearchResult> {
    const allowed = options.allowedPaths ? new Set(options.allowedPaths) : null;
    const openViews = new Map<string, MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file) openViews.set(leaf.view.file.path, leaf.view);
    }
    const files = this.app.vault.getMarkdownFiles()
      .filter(file => !allowed || allowed.has(file.path))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 600);
    const paths = new Set(files.map(file => file.path));
    if (!options.allowedPaths) {
      for (const path of this.researchIndex.paths()) {
        if (!paths.has(path)) {
          this.researchIndex.remove(path);
          this.indexedRevisions.delete(path);
        }
      }
    }
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(files.slice(i, i + 8).map(async file => {
        const links = Object.keys(this.app.metadataCache.resolvedLinks?.[file.path] ?? {})
          .filter(path => !allowed || allowed.has(path));
        // Obsidian editors may hold unsaved buffers while file mtime remains
        // unchanged. Include the active editor text fingerprint in the revision.
        const editorText = openViews.get(file.path)?.editor.getValue();
        let fingerprint = 2166136261;
        if (editorText !== undefined) {
          for (let j = 0; j < editorText.length; j++) {
            fingerprint ^= editorText.charCodeAt(j);
            fingerprint = Math.imul(fingerprint, 16777619);
          }
        }
        const revision = file.stat.mtime + ":" + file.stat.size + ":" + links.join(",") +
          (editorText === undefined ? "" : ":editor:" + editorText.length + ":" + (fingerprint >>> 0));
        if (this.indexedRevisions.get(file.path) === revision) return;
        const note = editorText === undefined ? await this.loadNote(file.path)
          : { file: file.path, content: editorText };
        if (!note) return;
        this.researchIndex.upsert({
          path: file.path,
          content: note.content.slice(0, 120_000),
          links,
          revision,
        });
        this.indexedRevisions.set(file.path, revision);
      }));
    }
    return this.researchIndex.search(query, { limit: options.limit, allowedPaths: options.allowedPaths });
  }

  private invalidateResearch(path: string): void {
    this.researchIndex.remove(path);
    this.indexedRevisions.delete(path);
  }

  async loadNote(
    path: string,
  ): Promise<{ file: string; content: string } | null> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (
        leaf.view instanceof MarkdownView &&
        leaf.view.file?.path === path
      ) {
        return {
          file: path,
          content: leaf.view.editor.getValue(),
        };
      }
    }

    const file = this.app.vault.getFileByPath(path);
    if (!file || !(file instanceof TFile)) return null;

    return {
      file: file.path,
      content: await this.app.vault.cachedRead(file),
    };
  }

  private captureCurrentMarkdownView(): void {
    const active =
      this.app.workspace.getActiveViewOfType(MarkdownView);

    if (active) {
      this.lastMarkdownView = active;
    }
  }

  private getRelevantMarkdownView(): MarkdownView | null {
    const active =
      this.app.workspace.getActiveViewOfType(MarkdownView);

    if (active) {
      this.lastMarkdownView = active;
      return active;
    }

    if (
      this.lastMarkdownView?.file &&
      this.app.workspace
        .getLeavesOfType("markdown")
        .some((leaf) => leaf.view === this.lastMarkdownView)
    ) {
      return this.lastMarkdownView;
    }

    this.lastMarkdownView = null;
    return null;
  }
}
