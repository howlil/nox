import assert from "node:assert/strict";
import test from "node:test";
import { LocalResearchIndex, splitNote, decomposeResearchQuestion } from "../../src/context/LocalResearch";

test("extracts headed chunks with source locations", () => {
  const chunks = splitNote("tcp.md", "# Intro\nRTT controls congestion.\n## Window\nBDP depends on RTT.");
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, "Intro");
  assert.equal(chunks[1].heading, "Window");
  assert.equal(chunks[1].line, 4);
});

test("retrieves relevant content, not just note titles", () => {
  const index = new LocalResearchIndex();
  index.upsert({ path: "one.md", content: "# Transport\nHigh RTT can affect TCP throughput.", links: ["two.md"], revision: "v1" });
  index.upsert({ path: "two.md", content: "# Congestion\nCongestion window limits bytes in flight.", links: [], revision: "v1" });
  index.upsert({ path: "irrelevant.md", content: "# Dinner\nTomatoes and pasta", links: [], revision: "v1" });
  const result = index.search("research RTT throughput and congestion window", { limit: 4 });
  assert.ok(result.hits.some(hit => hit.path === "one.md"));
  assert.ok(result.hits.some(hit => hit.path === "two.md"));
  assert.ok(result.edges.some(edge => edge.from === "one.md" && edge.to === "two.md"));
  assert.ok(!result.hits.some(hit => hit.path === "irrelevant.md"));
});

test("source allowlist blocks cross-vault graph expansion", () => {
  const index = new LocalResearchIndex();
  index.upsert({ path: "approved.md", content: "RTT", links: ["secret.md"], revision: "1" });
  index.upsert({ path: "secret.md", content: "RTT internal credential", links: [], revision: "1" });
  const result = index.search("RTT network", { allowedPaths: ["approved.md"], limit: 8 });
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].path, "approved.md");
  assert.deepEqual(result.edges, []);
});

test("revision changes update the index and deletions remove evidence", () => {
  const index = new LocalResearchIndex();
  index.upsert({ path: "note.md", content: "legacy", links: [], revision: "1" });
  index.upsert({ path: "note.md", content: "latency", links: [], revision: "2" });
  assert.ok(index.search("latency").hits.length > 0);
  assert.equal(index.search("legacy").hits.length, 0);
  index.remove("note.md");
  assert.equal(index.search("latency").hits.length, 0);
  assert.deepEqual(decomposeResearchQuestion("TCP vs UDP"), ["TCP vs UDP"]);
});
