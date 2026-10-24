import assert from "node:assert/strict";
import test from "node:test";
import { ContextResolver } from "../../src/context/ContextResolver";

test("M9 explicit-only source resolution never reads ambient note or selection", async () => {
  const calls: string[] = [];
  const resolver = new ContextResolver({
    getSelection: () => { calls.push("selection"); throw new Error("ambient selection read"); },
    getCurrentNote: async () => { calls.push("active-note"); throw new Error("ambient note read"); },
    loadNote: async (path: string) => {
      calls.push("explicit:" + path);
      return { file: path, content: "The explicitly selected source." };
    },
    searchNotes: () => [],
    searchKnowledge: async (query: string) => ({
      query, subquestions: [query], hits: [], edges: [],
    }),
  } as never);
  const result = await resolver.resolve([{ kind: "vault-note", path: "approved.md" }],
    { includeAmbient: false });
  assert.deepEqual(calls, ["explicit:approved.md"]);
  assert.equal(result.activeNote, undefined);
  assert.equal(result.selection, undefined);
  assert.deepEqual(result.explicit.map(note => note.path), ["approved.md"]);
});
