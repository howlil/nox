import assert from "node:assert/strict";
import test from "node:test";
import { constrainResearchContext, parseResearchRequest, resolveResearchScope } from "../../src/application/research-scope";

test("legacy research stays vault-scoped unless an explicit scope is supplied", () => {
  assert.deepEqual(parseResearchRequest("/research consistency"), {
    query: "consistency", scope: { kind: "vault" },
  });
  assert.equal(parseResearchRequest("hello"), null);
  assert.deepEqual(parseResearchRequest('/research --scope=folder:"Work Notes" latency'), {
    query: "latency", scope: { kind: "folder", path: "Work Notes" },
  });
  assert.deepEqual(parseResearchRequest("/research --scope=selected consensus"), {
    query: "consensus", scope: { kind: "selected" },
  });
});

test("source-bound constraints override requested vault-wide access", () => {
  const scope = resolveResearchScope({ kind: "vault" }, {
    sourceBoundPaths: ["approved.md"], selectedPaths: ["secret.md"],
  });
  assert.deepEqual(scope, { kind: "selected", paths: ["approved.md"] });
  assert.deepEqual(resolveResearchScope({ kind: "selected" }, {
    selectedPaths: ["a.md", "a.md"],
  }), { kind: "selected", paths: ["a.md"] });
  assert.throws(() => resolveResearchScope({ kind: "selected" }, {
    selectedPaths: [],
  }), /Select a note/);
  assert.throws(() => resolveResearchScope({ kind: "folder", path: "../secrets" }, {
    selectedPaths: [],
  }), /valid vault-relative/);
});

test("final provider authority removes off-scope ambient, attachments and policy", () => {
  const sources = [
    { type: "note" as const, file: "Private/payroll.md", content: "PAYROLL_SECRET" },
    { type: "note" as const, file: "Study Notes/concurrency.md", content: "approved" },
    { type: "note" as const, file: "Study Notes Other/secret.md", content: "lookalike" },
    { type: "note" as const, file: "AGENTS.md", content: "outside system policy" },
    { type: "note" as const, file: "attachment/private.txt", content: "attachment" },
  ];
  assert.deepEqual(constrainResearchContext(sources, {
    kind: "folder", path: "Study Notes",
  }).map(item => item.file), ["Study Notes/concurrency.md"]);
  assert.deepEqual(constrainResearchContext(sources, {
    kind: "selected", paths: ["Study Notes/concurrency.md"],
  }).map(item => item.file), ["Study Notes/concurrency.md"]);
  assert.equal(constrainResearchContext(sources, { kind: "vault" }).length, sources.length);
});
