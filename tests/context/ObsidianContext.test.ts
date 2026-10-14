import assert from "node:assert/strict";
import test from "node:test";
import {
  MarkdownView,
  Plugin,
  TFile,
} from "obsidian";
import { ObsidianContext, selectRecentMarkdownFiles } from "../../src/context/ObsidianContext";

function editor(value: string, selection = "") {
  return {
    getValue: () => value,
    getSelection: () => selection,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    replaceRange: () => {},
  };
}

test("keeps the last Markdown selection when Nox takes focus", () => {
  const file = new TFile("indexes.md");
  const view = new MarkdownView(
    file,
    editor("whole note", "selected B+ tree"),
  );

  let active: MarkdownView | null = view;
  const leaves = [{ view }];
  const workspace = {
    on: () => ({}),
    getActiveViewOfType: () => active,
    getLeavesOfType: () => leaves,
    getActiveFile: () => file,
  };

  const context = new ObsidianContext(
    { workspace, vault: {} } as never,
    new Plugin(),
  );

  active = null;

  assert.deepEqual(context.getSelection(), {
    file: "indexes.md",
    content: "selected B+ tree",
  });
});

test("current note uses unsaved editor content before vault content", async () => {
  const file = new TFile("note.md");
  const view = new MarkdownView(
    file,
    editor("unsaved editor value"),
  );
  let reads = 0;

  const context = new ObsidianContext(
    {
      workspace: {
        on: () => ({}),
        getActiveViewOfType: () => view,
        getLeavesOfType: () => [{ view }],
        getActiveFile: () => file,
      },
      vault: {
        cachedRead: async () => {
          reads += 1;
          return "old disk value";
        },
      },
    } as never,
    new Plugin(),
  );

  assert.deepEqual(await context.getCurrentNote(), {
    file: "note.md",
    content: "unsaved editor value",
  });
  assert.equal(reads, 0);
});

test("loadNote prefers another open editor and falls back to the vault", async () => {
  const openFile = new TFile("open.md");
  const closedFile = new TFile("closed.md");
  const openView = new MarkdownView(
    openFile,
    editor("live open content"),
  );

  const context = new ObsidianContext(
    {
      workspace: {
        on: () => ({}),
        getActiveViewOfType: () => null,
        getLeavesOfType: () => [{ view: openView }],
        getActiveFile: () => null,
      },
      vault: {
        getFileByPath: (path: string) =>
          path === "closed.md" ? closedFile : null,
        cachedRead: async () => "cached closed content",
      },
    } as never,
    new Plugin(),
  );

  assert.equal(
    (await context.loadNote("open.md"))?.content,
    "live open content",
  );
  assert.equal(
    (await context.loadNote("closed.md"))?.content,
    "cached closed content",
  );
  assert.equal(await context.loadNote("missing.md"), null);
});

test("searchNotes prioritizes basename prefixes and respects limit", () => {
  const files = [
    new TFile("notes/data-model.md"),
    new TFile("Database Index.md"),
    new TFile("Data.md"),
    new TFile("unrelated.md"),
  ];

  const context = new ObsidianContext(
    {
      workspace: {
        on: () => ({}),
        getActiveViewOfType: () => null,
        getLeavesOfType: () => [],
        getActiveFile: () => null,
      },
      vault: {
        getMarkdownFiles: () => files,
      },
    } as never,
    new Plugin(),
  );

  assert.deepEqual(context.searchNotes("data", 2), [
    { path: "Data.md", name: "Data" },
    { path: "Database Index.md", name: "Database Index" },
  ]);
});

test("bounded newest-file selection matches stable full-sort semantics", () => {
  const files = Array.from({ length: 1200 }, (_, i) =>
    new TFile("f" + i + ".md", { mtime: i % 19 }));
  const expected = files.slice().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 600);
  assert.deepEqual(selectRecentMarkdownFiles(files, 600), expected);
  assert.deepEqual(selectRecentMarkdownFiles(files, 0), []);
  assert.deepEqual(selectRecentMarkdownFiles(files.slice(0, 2), 600),
    files.slice(0, 2).sort((a, b) => b.stat.mtime - a.stat.mtime));
});
