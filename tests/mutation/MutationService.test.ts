import assert from "node:assert/strict";
import test from "node:test";
import {
  MarkdownView,
  TFile,
} from "obsidian";
import { MutationService } from "../../src/mutation/MutationService";

function makeEditor(value: string) {
  const calls: Array<{
    replacement: string;
    from: unknown;
    to: unknown;
  }> = [];

  return {
    calls,
    editor: {
      getValue: () => value,
      getSelection: () => "",
      offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
      replaceRange: (
        replacement: string,
        from: unknown,
        to: unknown,
      ) => {
        calls.push({ replacement, from, to });
      },
    },
  };
}

function makeService(input: {
  fileExists?: boolean;
  editorValue?: string;
  openEditor?: boolean;
}) {
  const file = new TFile("note.md");
  const { editor, calls } = makeEditor(
    input.editorValue ?? "before target after",
  );
  const view = new MarkdownView(file, editor);

  let vaultModifyCalls = 0;

  const service = new MutationService({
    vault: {
      getFileByPath: () =>
        input.fileExists === false ? null : file,
      modify: async () => {
        vaultModifyCalls += 1;
      },
    },
    workspace: {
      getLeavesOfType: () =>
        input.openEditor === false ? [] : [{ view }],
    },
  } as never);

  return {
    service,
    calls,
    getVaultModifyCalls: () => vaultModifyCalls,
  };
}

const proposal = {
  file: "note.md",
  original: "target",
  replacement: "replacement",
};

test("rejects edits outside the mutable primary note", async () => {
  const { service } = makeService({});

  const result = await service.apply(proposal, "other.md");

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "unauthorized");
});

test("requires the target file and an open editor", async () => {
  const missing = await makeService({
    fileExists: false,
  }).service.apply(proposal, "note.md");

  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "missing-file");

  const closed = await makeService({
    openEditor: false,
  }).service.apply(proposal, "note.md");

  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.reason, "no-editor");
});

test("rejects stale and ambiguous replacements", async () => {
  const stale = await makeService({
    editorValue: "no match",
  }).service.apply(proposal, "note.md");

  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.reason, "stale");

  const ambiguous = await makeService({
    editorValue: "target and target",
  }).service.apply(proposal, "note.md");

  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) {
    assert.equal(ambiguous.reason, "ambiguous");
  }
});

test("applies one exact editor replacement without vault.modify", async () => {
  const harness = makeService({
    editorValue: "before target after",
  });

  const result = await harness.service.apply(
    proposal,
    "note.md",
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(harness.calls, [
    {
      replacement: "replacement",
      from: { line: 0, ch: 7 },
      to: { line: 0, ch: 13 },
    },
  ]);
  assert.equal(harness.getVaultModifyCalls(), 0);
});


test("overlapping original candidates cannot be applied", async () => {
  const harness = makeService({ editorValue: "aaaa" });
  const result = await harness.service.apply({
    file: "note.md", original: "aaa", replacement: "x",
  }, "note.md");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "ambiguous");
  assert.equal(harness.calls.length, 0);
});
