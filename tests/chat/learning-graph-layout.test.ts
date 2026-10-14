import assert from "node:assert/strict";
import test from "node:test";
import { layoutLearningMap } from "../../src/chat/learning-graph-layout";

test("builds deterministic prerequisite arrows from earlier to later levels", () => {
  const map = layoutLearningMap([
    { id: "api", title: "HTTP API", status: "learning", prerequisiteIds: ["net"] },
    { id: "net", title: "Networking", status: "mastered", prerequisiteIds: [] },
    { id: "db", title: "Database", status: "learning", prerequisiteIds: ["net"] },
    { id: "scale", title: "Scaling", status: "locked", prerequisiteIds: ["api", "db"] },
  ]);
  assert.equal(map.problem, undefined);
  assert.equal(map.nodes.length, 4);
  assert.equal(map.edges.length, 4);
  const levels = Object.fromEntries(map.nodes.map(n => [n.id, n.level]));
  assert.deepEqual(levels, { net: 0, db: 1, api: 1, scale: 2 });
  assert.ok(map.edges.every(edge => edge.x1 < edge.x2));
});

test("cycles and large graphs have safe textual fallbacks", () => {
  const cycle = layoutLearningMap([
    { id: "a", title: "A", status: "learning", prerequisiteIds: ["b"] },
    { id: "b", title: "B", status: "learning", prerequisiteIds: ["a"] },
  ]);
  assert.equal(cycle.problem, "cycle");
  assert.equal(cycle.nodes.length, 0);
  const large = layoutLearningMap(Array.from({ length: 41 }, (_, index) => ({
    id: String(index), title: "Module " + index, status: "locked", prerequisiteIds: [],
  })));
  assert.equal(large.problem, "large");
  assert.deepEqual(large.edges, []);
});

test("unknown prerequisite references are ignored for layout only", () => {
  const map = layoutLearningMap([
    { id: "a", title: "Basics", status: "learning", prerequisiteIds: ["missing"] },
  ]);
  assert.equal(map.nodes[0].level, 0);
  assert.equal(map.edges.length, 0);
});
