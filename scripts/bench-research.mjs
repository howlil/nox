/**
 * Local, synthetic microbenchmark. Does NOT measure inference/network latency.
 * Usage: pnpm bench:research
 */
import { build } from "esbuild";
import { performance } from "node:perf_hooks";

const bundle = await build({
  entryPoints: ["src/context/LocalResearch.ts"],
  bundle: true, platform: "node", format: "esm", target: "node22",
  write: false, logLevel: "silent",
});
const source = Buffer.from(bundle.outputFiles[0].text).toString("base64");
const { LocalResearchIndex } = await import("data:text/javascript;base64," + source);
const index = new LocalResearchIndex();
const samples = Number(process.env.NOX_BENCH_FILES || 600);
if (!Number.isInteger(samples) || samples < 1 || samples > 6000) {
  throw new Error("NOX_BENCH_FILES must be an integer between 1 and 6000");
}
const keywords = ["latency", "tcp", "concurrency", "databases", "throughput", "transactions"];
const notes = Array.from({ length: samples }, (_, i) => ({
  path: "notes/note-" + i + ".md",
  content: "# Topic " + i + "\n" +
    Array.from({ length: 90 }, (_, j) => keywords[(i + j) % keywords.length] +
      " system explanation with bounded context and evidence").join("\n"),
  links: i === 0 ? [] : ["notes/note-" + (i - 1) + ".md"],
  revision: "v1",
}));
function stats(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return { p50Ms: Number(sorted[Math.floor((sorted.length - 1) * .5)].toFixed(3)),
    p95Ms: Number(sorted[Math.floor((sorted.length - 1) * .95)].toFixed(3)) };
}
const started = performance.now();
for (const note of notes) index.upsert(note);
const indexingMs = performance.now() - started;
const warm = [];
for (let i = 0; i < 30; i++) {
  const begin = performance.now();
  index.search(keywords[i % keywords.length] + " technical explanation", { limit: 8 });
  warm.push(performance.now() - begin);
}
const readStart = performance.now();
index.search("network technical latency", { limit: 8 });
const latencyMs = performance.now() - readStart;
const bytes = process.memoryUsage().heapUsed;
console.log(JSON.stringify({
  kind: "synthetic-local-research-only", samples, indexingMs: Number(indexingMs.toFixed(3)),
  warmQuery: stats(warm), lastQueryMs: Number(latencyMs.toFixed(3)),
  heapUsedMiB: Number((bytes / 1024 / 1024).toFixed(2)),
  note: "Not a benchmark of Obsidian file I/O, ChatGPT/AGY/Codex, first token or first paint."
}, null, 2));
