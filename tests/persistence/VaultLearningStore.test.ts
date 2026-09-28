import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { VaultLearningStore } from "../../src/persistence/VaultLearningStore";

class MemoryVault {
  files = new Map<string, string>();
  folders = new Set<string>();

  getFileByPath(path: string) {
    if (!this.files.has(path)) return null;
    return new TFile(path);
  }

  getAbstractFileByPath(path: string) {
    return this.folders.has(path) ? { path } : null;
  }

  async cachedRead(file: TFile) {
    return this.files.get(file.path) ?? "";
  }

  async createFolder(path: string) {
    this.folders.add(path);
  }

  async create(path: string, content: string) {
    this.files.set(path, content);
    return new TFile(path);
  }

  async modify(file: TFile, content: string) {
    this.files.set(file.path, content);
  }
}

function makeStore(vault = new MemoryVault()) {
  const app = { vault };
  return {
    vault,
    store: new VaultLearningStore(app as never),
  };
}

test("returns default learning state when progress file is missing", async () => {
  const { store } = makeStore();

  const state = await store.load();

  assert.deepEqual(state, {
    version: 2,
    target: null,
    gaps: [],
    evidence: [],
  });
});

test("saves and reloads learning state without applying domain policy", async () => {
  const { vault, store } = makeStore();
  const state = {
    version: 2 as const,
    target: "backend",
    currentTopic: "MVCC",
    gaps: [
      {
        id: "gap-1",
        concept: "MVCC",
        reason: "visibility",
        evidenceIds: ["evidence-1"],
        status: "open" as const,
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        type: "practice" as const,
        scope: "learner" as const,
        concept: "MVCC",
        source: "note.md",
        outcome: "partial",
        createdAt: 10,
      },
    ],
  };

  await store.save(state);

  assert.equal(vault.folders.has("00-learning-os"), true);
  assert.ok(vault.files.has("00-learning-os/progress.json"));
  assert.deepEqual(await store.load(), state);
});

test("rejects malformed nested progress state", async () => {
  const { vault, store } = makeStore();
  vault.folders.add("00-learning-os");
  vault.files.set(
    "00-learning-os/progress.json",
    JSON.stringify({
      version: 1,
      target: null,
      gaps: [{}],
      evidence: [123],
    }),
  );

  await assert.rejects(
    () => store.load(),
    /unsupported shape/,
  );
});
