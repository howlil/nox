import assert from "node:assert/strict";
import test from "node:test";
import { parseResearchRequest, resolveResearchScope } from "../../src/application/research-scope";

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
