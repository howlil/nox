import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { PolicyLoader } from "../../src/context/PolicyLoader";

test("returns empty policy when AGENTS.md is missing", async () => {
  const loader = new PolicyLoader({
    vault: {
      getFileByPath: () => null,
    },
  } as never);

  assert.deepEqual(await loader.load(), {
    path: "AGENTS.md",
    rawInstructions: "",
  });
});

test("caches policy by mtime and reloads when it changes", async () => {
  const file = new TFile("AGENTS.md", { mtime: 1 });
  let reads = 0;
  let content = "first";

  const loader = new PolicyLoader({
    vault: {
      getFileByPath: () => file,
      cachedRead: async () => {
        reads += 1;
        return content;
      },
    },
  } as never);

  assert.equal((await loader.load()).rawInstructions, "first");
  assert.equal((await loader.load()).rawInstructions, "first");
  assert.equal(reads, 1);

  file.stat.mtime = 2;
  content = "second";

  assert.equal((await loader.load()).rawInstructions, "second");
  assert.equal(reads, 2);
});

test("loads only requested optional learning skill and refreshes cache on file changes", async () => {
  const file = new TFile("00-learning-os/skills/learning-assessment/SKILL.md", { mtime: 1, size: 10 });
  let content = "Read one question";
  let reads = 0;
  const loader = new PolicyLoader({
    vault: {
      getFileByPath: (path: string) => path === file.path ? file : null,
      cachedRead: async () => { reads++; return content; },
    },
  } as never);
  assert.equal(await loader.loadSkill("review"), null);
  assert.deepEqual(await loader.loadSkill("assessment"), { path: file.path, content: "Read one question" });
  assert.equal((await loader.loadSkill("assessment"))?.content, "Read one question");
  assert.equal(reads, 1);
  file.stat.mtime = 2;
  content = "Ask one new question";
  assert.equal((await loader.loadSkill("assessment"))?.content, "Ask one new question");
  assert.equal(reads, 2);
});

test("rejects oversize optional skills before including their contents", async () => {
  const file = new TFile("00-learning-os/skills/learning-teaching/SKILL.md", { mtime: 1, size: 13_000 });
  const loader = new PolicyLoader({
    vault: { getFileByPath: () => file, cachedRead: async () => "unread" },
  } as never);
  await assert.rejects(loader.loadSkill("teaching"), /12 KB/);
});
