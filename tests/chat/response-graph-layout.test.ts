import assert from "node:assert/strict";
import test from "node:test";
import { layoutNoxFlow } from "../../src/chat/response-graph-layout";
import { parseNoxFlow } from "../../src/chat/response-spec";

test("wide branching user flows remain vertically ordered inside a 360px canvas", () => {
  const spec = parseNoxFlow(JSON.stringify({
    version: 1, direction: "TB", layout: "vertical-stack",
    nodes: [
      { id: "sidebar", label: "NOX Sidebar" },
      { id: "state", label: "Thread state" },
      { id: "empty", label: "Empty workspace" },
      { id: "history", label: "Conversation" },
      { id: "composer", label: "Composer", kind: "focus" },
      { id: "run", label: "Running / Thinking" },
      ...["plain", "quiz", "review", "edit", "error"].map(id => ({ id, label: id })),
    ],
    edges: [
      { from: "sidebar", to: "state" },
      { from: "state", to: "empty" }, { from: "state", to: "history" },
      { from: "empty", to: "composer" }, { from: "history", to: "composer" },
      { from: "composer", to: "run" },
      ...["plain", "quiz", "review", "edit", "error"].map(id => ({ from: "run", to: id })),
    ],
  }));
  assert.ok(spec);
  const layout = layoutNoxFlow(spec);
  assert.equal(layout.width, 360);
  assert.equal(layout.nodes.length, 11);
  assert.equal(layout.edges.length, 11);
  const placed = new Map(layout.nodes.map(node => [node.id, node]));
  assert.ok(layout.nodes.every(node => node.x >= 0 && node.x + node.width <= layout.width));
  assert.ok(layout.edges.every(edge => placed.get(edge.from)!.y < placed.get(edge.to)!.y));
  assert.equal(placed.get("run")?.x, placed.get("quiz")?.x);
  assert.ok(layout.height > layout.width);
  assert.deepEqual(layoutNoxFlow(spec), layout);
});

test("layered graph ordering is deterministic with disconnected roots", () => {
  const spec = parseNoxFlow(JSON.stringify({
    version: 1, direction: "TB", layout: "layered",
    nodes: [
      { id: "b", label: "B" }, { id: "a", label: "A" },
      { id: "c", label: "C" }, { id: "d", label: "D" },
    ],
    edges: [{ from: "a", to: "c" }, { from: "b", to: "d" }],
  }));
  assert.ok(spec);
  const layout = layoutNoxFlow(spec);
  assert.equal(layout.nodes.length, 4);
  assert.ok(layout.edges.every(edge => edge.path.startsWith("M ")));
  assert.ok(layout.nodes[2].rank > layout.nodes[1].rank);
});
