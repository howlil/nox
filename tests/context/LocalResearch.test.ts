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

test("long research chunks point to their actual source line", () => {
  const content = "# Networking\n" + Array.from({ length: 50 }, (_, i) => "Line " + i + " high throughput and latency").join("\n");
  const chunks = splitNote("network.md", content);
  assert.ok(chunks.length > 1);
  assert.ok(chunks[1].line > chunks[0].line);
  const sourceLine = content.split("\n")[chunks[1].line - 1];
  assert.ok(sourceLine);
});

test("sparse index gives stable scores across repeated queries without changing revisions", () => {
  const index = new LocalResearchIndex();
  index.upsert({ path: "systems/tcp.md", content: "# TCP\nTCP throughput relies on windows and latency.",
    links: ["systems/network.md"], revision: "v1" });
  index.upsert({ path: "systems/network.md", content: "# Network\nLatency and throughput are different metrics.",
    links: [], revision: "v1" });
  const before = index.search("latency throughput", { limit: 8 });
  const after = index.search("latency throughput", { limit: 8 });
  assert.deepEqual(after, before);
  assert.ok(after.hits.length >= 1);
  assert.ok(after.hits.every(hit => hit.score > 0 && hit.revision === "v1"));
});

test("posting updates remove stale terms and revised graph links", () => {
  const index = new LocalResearchIndex();
  index.upsert({ path: "a.md", content: "# Notes\nconsistency only", links: ["b.md"], revision: "1" });
  index.upsert({ path: "b.md", content: "# Notes\nconsistency and durability", links: [], revision: "1" });
  assert.ok(index.search("consistency").edges.some(edge => edge.to === "b.md"));
  index.upsert({ path: "a.md", content: "# Notes\nlatency only", links: [], revision: "2" });
  assert.ok(index.search("latency").hits.some(hit => hit.path === "a.md"));
  assert.ok(!index.search("consistency").hits.some(hit => hit.path === "a.md"));
  assert.deepEqual(index.search("consistency").edges, []);
  index.remove("a.md");
  assert.ok(!index.search("latency").hits.some(hit => hit.path === "a.md"));
});

test("multiple matching terms never duplicate a chunk", () => {
  const index = new LocalResearchIndex();
  index.upsert({ path: "queries.md", content: "Latency throughput throughput latency",
    links: [], revision: "1" });
  const results = index.search("latency throughput");
  assert.equal(results.hits.length, 1);
  assert.ok(results.hits[0].score > 0);
});
