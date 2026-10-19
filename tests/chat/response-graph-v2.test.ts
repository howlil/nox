import assert from "node:assert/strict";
import test from "node:test";
import { parseNoxFlowV2 } from "../../src/chat/response-graph-v2-schema";
import { layoutNoxFlowV2 } from "../../src/chat/response-graph-v2-layout";

const sample = {
  version: 2, title: "NOX architecture", direction: "TB", layout: "layered",
  groups: [{ id: "services", label: "Application Services" }],
  nodes: [
    { id: "root", label: "Obsidian Desktop" },
    { id: "app", label: "Application Layer", group: "services", kind: "focus" },
    { id: "agent", label: "Agent Runtime", group: "services" },
    { id: "vault", label: "Vault Persistence" },
  ],
  edges: [
    { from: "root", to: "app" },
    { from: "app", to: "agent", label: "runs" },
    { from: "app", to: "vault", label: "persists" },
  ],
};
const parse = (value: unknown) => parseNoxFlowV2(JSON.stringify(value));

test("v2 accepts bounded groups, labels and LR/TB directions", () => {
  assert.deepEqual(parse(sample)?.edges, sample.edges);
  assert.equal(parse({ ...sample, direction: "LR" })?.direction, "LR");
  assert.equal(parse({ ...sample, groups: [], nodes: sample.nodes.map(({ group: _group, ...n }) => n) })?.groups.length, 0);
});

test("v2 rejects invalid boundary data without affecting v1", () => {
  assert.equal(parse({ ...sample, version: 1 }), null);
  assert.equal(parse({ ...sample, direction: "BR" }), null);
  assert.equal(parse({ ...sample, groups: [{ id: "services", label: "" }] }), null);
  assert.equal(parse({ ...sample, groups: [{ id: "root", label: "Collision" }] }), null);
  assert.equal(parse({ ...sample, nodes: [...sample.nodes, sample.nodes[0]] }), null);
  assert.equal(parse({ ...sample, nodes: [{ id: "a", label: "<script>", group: "missing" }] }), null);
  assert.equal(parse({ ...sample, edges: [{ from: "root", to: "missing" }] }), null);
  assert.equal(parse({ ...sample, edges: [sample.edges[0], sample.edges[0]] }), null);
  assert.equal(parse({ ...sample, nodes: [{ id: "__proto__", label: "Poison" }] }), null);
  assert.equal(parse({ ...sample, nodes: [...sample.nodes, ...Array.from({ length: 37 }, (_, i) => ({ id: "extra" + i, label: "N" }))] }), null);
  assert.equal(parseNoxFlowV2("{bad json}"), null);
  assert.equal(parseNoxFlowV2("x".repeat(80_001)), null);
});

test("v2 can represent cycles, unlike legacy acyclic nox-flow", () => {
  const input = { version: 2, direction: "LR", layout: "layered", groups: [],
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] };
  assert.ok(parse(input));
});

test("ELK v2 routes grouped architecture edges and preserves every connection", async () => {
  const spec = parse(sample);
  assert.ok(spec);
  const result = await layoutNoxFlowV2(spec);
  assert.equal(result.nodes.length, sample.nodes.length);
  assert.equal(result.groups.length, sample.groups.length);
  assert.equal(result.edges.length, sample.edges.length);
  assert.ok(result.width > 0 && result.width <= 12_000);
  assert.ok(result.height > 0 && result.height <= 12_000);
  assert.ok(result.edges.every(edge => edge.path.startsWith("M ") && edge.path.includes(" L ")));
  assert.equal(result.edges[1].label, "runs");
  const group = result.groups[0];
  for (const node of result.nodes.filter(node => node.group === group.id)) {
    assert.ok(node.x >= group.x && node.x + node.width <= group.x + group.width);
    assert.ok(node.y >= group.y && node.y + node.height <= group.y + group.height);
  }
});

test("ELK v2 layouts keep left-to-right direction for simple graphs", async () => {
  const spec = parse({ version: 2, direction: "LR", layout: "layered", groups: [],
    nodes: [{ id: "start", label: "Start" }, { id: "end", label: "End" }],
    edges: [{ from: "start", to: "end", label: "next" }] });
  assert.ok(spec);
  const layout = await layoutNoxFlowV2(spec);
  const from = layout.nodes.find(n => n.id === "start")!;
  const to = layout.nodes.find(n => n.id === "end")!;
  assert.ok(from.x < to.x);
  assert.equal(layout.edges[0].label, "next");
  assert.ok(layout.edges[0].labelX !== undefined);
});
