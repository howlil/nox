import assert from "node:assert/strict";
import test from "node:test";
import { ComposerAttachmentDraft } from "../../src/chat/composer-draft";

test("explicit contexts are derived from one attachment owner", () => {
  const draft = new ComposerAttachmentDraft();
  const a = draft.add("src.ts", { kind: "attachment", name: "src.ts", content: "hello" });
  const b = draft.add("note.md", { kind: "vault-note", path: "vault/note.md" });
  const c = draft.add("same-name.md", { kind: "vault-note", path: "vault/different.md" });

  assert.equal(draft.length, 3);
  assert.equal(draft.hasNote("vault/note.md"), true);
  assert.equal(draft.hasNote("note.md"), false);
  assert.deepEqual(draft.contexts().map(x => x.kind), ["attachment", "vault-note", "vault-note"]);
  const snapshot = draft.contexts();
  snapshot.pop();
  const note = snapshot.find(ref => ref.kind === "vault-note");
  if (note?.kind === "vault-note") note.path = "changed.md";
  assert.equal(draft.hasNote("vault/note.md"), true);
  assert.equal(draft.length, 3, "a returned projection cannot mutate internal attachment state");

  assert.equal(draft.remove(b), true);
  assert.equal(draft.remove(b), false, "stale remove event must be idempotent");
  assert.equal(draft.hasNote("vault/note.md"), false);
  assert.equal(draft.remove(a), true);
  assert.deepEqual(draft.items(), [c]);
  draft.clear();
  assert.equal(draft.length, 0);
  assert.deepEqual(draft.contexts(), []);
});

test("adding another note does not change unrelated draft objects", () => {
  const draft = new ComposerAttachmentDraft();
  const a = draft.add("shared", { kind: "vault-note", path: "a/shared.md" });
  const b = draft.add("shared", { kind: "vault-note", path: "b/shared.md" });
  assert.deepEqual(draft.items(), [a,b]);
  assert.equal(draft.remove(a), true);
  assert.equal(draft.hasNote("b/shared.md"), true);
  draft.clear();
  assert.equal(draft.remove(b), false);
});
