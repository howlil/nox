import assert from "node:assert/strict";
import test from "node:test";
import { Plugin, TFile } from "obsidian";
import { ObsidianContext } from "../../../src/context/ObsidianContext";

test("search reads only allowed files and does not leak previously cached hits", async () => {
  const files = [
    new TFile("public/network.md", { mtime: 10 }),
    new TFile("private/accounts.md", { mtime: 11 }),
  ];
  const reads: string[] = [];
  const context = new ObsidianContext({
    workspace: {
      on: () => ({}), getActiveViewOfType: () => null,
      getLeavesOfType: () => [], getActiveFile: () => null,
    },
    metadataCache: { on: () => ({}), resolvedLinks: {} },
    vault: {
      on: () => ({}),
      getMarkdownFiles: () => files,
      getFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
      cachedRead: async (file: TFile) => {
        reads.push(file.path);
        return "# Research\nProtected experimental latency notes " + file.path;
      },
    },
  } as never, new Plugin());

  const scoped = await context.searchKnowledge("latency", {
    scope: { kind: "folder", path: "public" },
  });
  assert.deepEqual(reads, ["public/network.md"]);
  assert.ok(scoped.hits.every(hit => hit.path === "public/network.md"));

  await context.searchKnowledge("latency", { scope: { kind: "vault" } });
  assert.ok(reads.includes("private/accounts.md"));

  const selected = await context.searchKnowledge("latency", {
    scope: { kind: "selected", paths: ["public/network.md"] },
  });
  assert.ok(selected.hits.length > 0);
  assert.ok(selected.hits.every(hit => hit.path === "public/network.md"));
});
