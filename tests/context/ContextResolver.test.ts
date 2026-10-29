import assert from "node:assert/strict";
import test from "node:test";
import { ContextResolver } from "../../src/context/ContextResolver";
import type { ContextSourcePort } from "../../packages/core/src/context/ContextSourcePort";

test("resolves vault-note refs using latest content at turn start", async () => {
  let noteContent = "old";

  const source = {
    getSelection: () => null,
    getCurrentNote: async () => ({
      file: "current.md",
      content: "current",
    }),
    loadNote: async (path: string) => ({
      file: path,
      content: noteContent,
    }),
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const ref = {
    kind: "vault-note" as const,
    path: "support.md",
  };

  noteContent = "latest";
  const context = await resolver.resolve([ref]);

  assert.equal(context.explicit[0]?.content, "latest");
});

test("selection remains the primary automatic agent context", async () => {
  const source = {
    getSelection: () => ({
      file: "current.md",
      content: "selected",
    }),
    getCurrentNote: async () => ({
      file: "current.md",
      content: "whole note",
    }),
    loadNote: async () => null,
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const context = await resolver.resolve();
  const agentContext = resolver.toAgentContext(context);

  assert.deepEqual(agentContext, [
    {
      type: "selection",
      file: "current.md",
      content: "selected",
    },
  ]);
});

test("uses the active note when there is no selection", async () => {
  const source = {
    getSelection: () => null,
    getCurrentNote: async () => ({
      file: "current.md",
      content: "whole note",
    }),
    loadNote: async () => null,
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const context = await resolver.resolve();

  assert.deepEqual(resolver.toAgentContext(context), [
    {
      type: "note",
      file: "current.md",
      content: "whole note",
    },
  ]);
});

test("supports attachment context and preserves explicit order", async () => {
  const source = {
    getSelection: () => null,
    getCurrentNote: async () => null,
    loadNote: async (path: string) => ({
      file: path,
      content: "vault content",
    }),
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const refs = [
    {
      kind: "attachment" as const,
      name: "notes.txt",
      content: "attachment content",
    },
    {
      kind: "vault-note" as const,
      path: "support.md",
    },
  ];

  const context = await resolver.resolve(refs);

  assert.deepEqual(
    context.explicit.map((item) => item.path),
    ["attachment/notes.txt", "support.md"],
  );
  assert.deepEqual(refs, [
    {
      kind: "attachment",
      name: "notes.txt",
      content: "attachment content",
    },
    {
      kind: "vault-note",
      path: "support.md",
    },
  ]);
});

test("fails explicitly when a requested vault note disappears", async () => {
  const source = {
    getSelection: () => null,
    getCurrentNote: async () => null,
    loadNote: async () => null,
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);

  await assert.rejects(
    () =>
      resolver.resolve([
        {
          kind: "vault-note",
          path: "missing.md",
        },
      ]),
    /no longer exists/,
  );
});

test("deduplicates explicit context identical to the primary context", async () => {
  const source = {
    getSelection: () => null,
    getCurrentNote: async () => ({
      file: "current.md",
      content: "same",
    }),
    loadNote: async () => ({
      file: "current.md",
      content: "same",
    }),
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const context = await resolver.resolve([
    {
      kind: "vault-note",
      path: "current.md",
    },
  ]);

  assert.deepEqual(resolver.toAgentContext(context), [
    {
      type: "note",
      file: "current.md",
      content: "same",
    },
  ]);
});

test("host-neutral context source forwards research authority and resolves editor freshness", async () => {
  let noteText = "unsaved editor v1";
  let receivedScope: unknown;
  const source: ContextSourcePort = {
    getSelection: () => null,
    getCurrentNote: async () => ({ file: "open.md", content: noteText }),
    loadNote: async path => path === "open.md" ? { file: path, content: noteText } : null,
    searchNotes: () => [{ path: "open.md", name: "open" }],
    searchKnowledge: async (query, options) => {
      receivedScope = options?.scope;
      return { query, subquestions: [], hits: [], edges: [] };
    },
  };
  const resolver = new ContextResolver(source);
  noteText = "unsaved editor v2";
  const resolved = await resolver.resolve([{ kind: "vault-note", path: "open.md" }]);
  assert.equal(resolved.activeNote?.content, "unsaved editor v2");
  assert.equal(resolved.explicit[0].content, "unsaved editor v2");
  assert.deepEqual(resolver.searchNotes("open"), [{ path: "open.md", name: "open" }]);
  const report = await resolver.searchKnowledge("private keyword",
    { scope: { kind: "selected", paths: ["open.md"] }, allowedPaths: ["open.md"], limit: 3 });
  assert.equal(report.query, "private keyword");
  assert.deepEqual(receivedScope, { kind: "selected", paths: ["open.md"] });
});

test("M1 onboarding metadata uses only note path, never selection/editor reads", () => {
  let contentReads = 0;
  const resolver = new ContextResolver({
    getActiveNotePath: () => "private-name.md",
    getSelection: () => { contentReads++; throw Error("selection content read"); },
    getCurrentNote: async () => { contentReads++; throw Error("note content read"); },
  } as never);
  assert.equal(resolver.getActiveNotePath(), "private-name.md");
  assert.equal(contentReads, 0);
});

test("M2 explicit-only onboarding note never reads or forwards another ambient editor source", async () => {
  let ambientReads = 0;
  const resolver = new ContextResolver({
    getSelection: () => { ambientReads++; throw Error("ambient selection leaked"); },
    getCurrentNote: async () => { ambientReads++; throw Error("ambient note leaked"); },
    loadNote: async (path: string) => ({
      file: path, content: "approved note content",
    }),
    searchNotes: () => [],
  } as never);
  const result = await resolver.resolve(
    [{ kind: "vault-note", path: "notes/Book.md" }],
    { includeAmbient: false },
  );
  assert.equal(ambientReads, 0);
  assert.equal(result.selection, undefined);
  assert.equal(result.activeNote, undefined);
  assert.deepEqual(resolver.toAgentContext(result), [{
    type: "note", file: "notes/Book.md", content: "approved note content",
  }]);
});
