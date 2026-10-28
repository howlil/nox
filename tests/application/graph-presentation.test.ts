import assert from "node:assert/strict";
import test from "node:test";
import { buildActionInstruction, selectGraphPresentation } from "../../packages/core/src/application/action-builders";

test("general diagrams route to Mermaid without suppressing legacy histories", () => {
  for (const prompt of ["buatkan diagram arsitektur", "show graph", "flowchart runtime", "peta konsep", "architecture map"]) {
    assert.equal(selectGraphPresentation(prompt), "mermaid");
  }
  assert.equal(selectGraphPresentation("show nox-flow JSON"), "nox-flow");
  assert.equal(selectGraphPresentation("render a diagram as nox-flow"), "nox-flow");
  assert.equal(selectGraphPresentation("jelaskan concurrency"), null);
});

test("ask and explain prefer native Mermaid; other learning actions stay unchanged", () => {
  for (const action of ["ask", "explain"] as const) {
    const prompt = buildActionInstruction(action);
    assert.match(prompt, /prefer fenced Mermaid flowcharts/);
    assert.match(prompt, /Use nox-flow v2 only when explicitly requested/);
    assert.match(prompt, /Avoid decorative subgraphs/);
  }
  assert.doesNotMatch(buildActionInstruction("review"), /prefer fenced Mermaid flowcharts/);
});
