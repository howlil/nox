import {
  App,
  MarkdownView,
  Plugin,
  TFile,
} from "obsidian";
import { LocalResearchIndex, type ResearchResult, type ResearchScope } from "@nox/core";

/**
 * Select the newest k files without sorting an entire large vault.
 * Stable mtime ties preserve the original enumeration order.
 * Time: O(V log k); extra space: O(k).
 */
export function selectRecentMarkdownFiles(files: TFile[], limit: number): TFile[] {
  if (limit <= 0) return [];
  if (files.length <= limit) return files.slice().sort((a, b) => b.stat.mtime - a.stat.mtime);
  type Entry = { file: TFile; order: number };
  const heap: Entry[] = [];
  // A smaller timestamp is older; tied files appearing later are older.
  const older = (a: Entry, b: Entry): boolean =>
    a.file.stat.mtime < b.file.stat.mtime ||
    (a.file.stat.mtime === b.file.stat.mtime && a.order > b.order);
  const swap = (a: number, b: number): void => {
    const tmp = heap[a];
    heap[a] = heap[b];
    heap[b] = tmp;
  };
  for (let order = 0; order < files.length; order++) {
    const entry = { file: files[order], order };
    if (heap.length < limit) {
      heap.push(entry);
      for (let i = heap.length - 1; i > 0;) {
        const parent = Math.floor((i - 1) / 2);
        if (!older(heap[i], heap[parent])) break;
        swap(i, parent);
        i = parent;
      }
    } else if (older(heap[0], entry)) {
      heap[0] = entry;
      for (let i = 0; i < heap.length;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && older(heap[left], heap[smallest])) smallest = left;
        if (right < heap.length && older(heap[right], heap[smallest])) smallest = right;
        if (smallest === i) break;
        swap(i, smallest);
        i = smallest;
      }
    }
  }
  return heap.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime || a.order - b.order)
    .map(entry => entry.file);
}

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
    if (typeof this.app.vault.on === "function") {
      plugin.registerEvent(this.app.vault.on("modify", file => this.invalidateResearch(file.path)));
      plugin.registerEvent(this.app.vault.on("delete", file => this.invalidateResearch(file.path)));
      plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
        this.invalidateResearch(oldPath);
        this.invalidateResearch(file.path);
      }));
    }
    if (typeof this.app.metadataCache?.on === "function") {
      plugin.registerEvent(this.app.metadataCache.on("changed", file => this.invalidateResearch(file.path)));
    }
  }

  /** Return the relevant note identity without touching editor.getValue/selection or vault reads. */
  getActiveNotePath(): string | undefined {
    const view = this.getRelevantMarkdownView();
    if (view?.file) return view.file.path;
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile ? file.path : undefined;
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
    scope?: ResearchScope;
    limit?: number;
  } = {}): Promise<ResearchResult> {
    const allowed = options.allowedPaths ? new Set(options.allowedPaths) : null;
    const scope: ResearchScope = options.scope ?? { kind: "vault" };
    const selected = scope.kind === "selected" ? new Set(scope.paths) : null;
    const inScope = (path: string): boolean =>
      (!allowed || allowed.has(path)) &&
      (!selected || selected.has(path)) &&
      (scope.kind !== "folder" || path.startsWith(scope.path + "/"));
    const openViews = new Map<string, MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file) openViews.set(leaf.view.file.path, leaf.view);
    }
    // Filter metadata before any file contents are read or indexed.
    const files = selectRecentMarkdownFiles(this.app.vault.getMarkdownFiles()
      .filter(file => inScope(file.path)), 600);
    const paths = new Set(files.map(file => file.path));
    if (!options.allowedPaths && scope.kind === "vault") {
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
    // Also constrain cached index hits: switching scopes must never expose
    // notes indexed by an earlier, broader research request.
    return this.researchIndex.search(query, {
      limit: options.limit, allowedPaths: [...paths],
    });
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
