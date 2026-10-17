import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { LearningStateWriteConflict, VaultLearningStore } from "../../src/persistence/VaultLearningStore";

class MemoryVault {
  files = new Map<string, string>();
  folders = new Set<string>();
  beforeProcess?: () => Promise<void>;
  failProcess = false;
  reads = 0;
  cachedReads = 0;

  getFileByPath(path: string) {
    if (!this.files.has(path)) return null;
    return new TFile(path);
  }

  getAbstractFileByPath(path: string) {
    return this.folders.has(path) ? { path } : null;
  }

  async read(file: TFile) {
    this.reads++;
    return this.files.get(file.path) ?? "";
  }

  async cachedRead(_file: TFile) {
    this.cachedReads++;
    return "stale pre-write cache";
  }

  async process(file: TFile, change: (current: string) => string) {
    if (this.beforeProcess) await this.beforeProcess();
    if (this.failProcess) throw new Error("Injected process failure");
    const previous = this.files.get(file.path);
    if (previous === undefined) throw new Error("Missing progress file");
    this.files.set(file.path, change(previous));
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

test("M7 uses authoritative vault.read rather than stale cachedRead for CAS", async () => {
  const { vault, store } = makeStore();
  await store.save({ version: 3, target: null, gaps: [], evidence: [] });
  assert.equal((await store.load()).version, 3);
  assert.ok(vault.reads > 0);
  assert.equal(vault.cachedReads, 0);
});

test("M7 concurrent writer cannot overwrite committed evidence from a stale snapshot", async () => {
  const { vault, store } = makeStore();
  await store.save({ version: 3, target: null, gaps: [], evidence: [] });
  const a = await store.load();
  const b = await store.load();
  const record = (id: string) => ({
    id, type: "review" as const, scope: "material" as const,
    concept: "Test", source: "notes.md", outcome: "gap", createdAt: 1,
  });
  await store.save({ ...a, evidence: [record("a")] }, a);
  await assert.rejects(store.save({ ...b, evidence: [record("b")] }, b),
    LearningStateWriteConflict);
  const current = await store.load();
  assert.deepEqual(current.evidence.map(x => x.id), ["a"]);
  await store.save({ ...current, evidence: [...current.evidence, record("b")] }, current);
  assert.deepEqual((await store.load()).evidence.map(x => x.id), ["a", "b"]);
  assert.equal(vault.cachedReads, 0);
});

test("M7 external process race fails closed, then accepts an explicit reload-and-retry", async () => {
  const { vault, store } = makeStore();
  await store.save({ version: 3, target: null, gaps: [], evidence: [] });
  const previous = await store.load();
  const path = "00-learning-os/progress.json";
  const changed = { version: 3, target: "external", gaps: [], evidence: [] };
  vault.files.set(path, JSON.stringify(changed));
  await assert.rejects(store.save({ ...previous, currentTopic: "lost" }, previous),
    LearningStateWriteConflict);
  assert.deepEqual(JSON.parse(vault.files.get(path)!), changed);
  const reload = await store.load();
  await store.save({ ...reload, currentTopic: "retried" }, reload);
  assert.equal((await store.load()).target, "external");
  assert.equal((await store.load()).currentTopic, "retried");
});

test("M7 injected Vault.process failure leaves progress bytes unchanged and queue reusable", async () => {
  const { vault, store } = makeStore();
  await store.save({ version: 3, target: null, gaps: [], evidence: [] });
  const before = await store.load();
  const path = "00-learning-os/progress.json";
  const saved = vault.files.get(path)!;
  vault.failProcess = true;
  await assert.rejects(store.save({ ...before, target: "test" }, before),
    /Unable to persist learning progress/);
  assert.equal(vault.files.get(path), saved);
  vault.failProcess = false;
  const after = await store.load();
  await store.save({ ...after, target: "recovered" }, after);
  assert.equal((await store.load()).target, "recovered");
});

test("M7 migration to evidence-v3 creates a verified non-destructive v2 backup", async () => {
  const { vault, store } = makeStore();
  vault.folders.add("00-learning-os");
  const old = { version: 2, target: null, gaps: [], evidence: [] };
  vault.files.set("00-learning-os/progress.json", JSON.stringify(old));
  const loaded = await store.load();
  await store.save({ ...loaded, version: 3 }, loaded);
  assert.equal((await store.load()).version, 3);
  const backups = [...vault.files.entries()].filter(([path]) =>
    /^00-learning-os\\/progress\\.v2-.*\\.backup\\.json$/.test(path));
  assert.equal(backups.length, 1);
  assert.equal(backups[0][1], JSON.stringify(old));
  const next = await store.load();
  await store.save({ ...next, target: "still v3" }, next);
  assert.equal([...vault.files.keys()].filter(path => path.endsWith(".backup.json")).length, 1);
});

test("M7 saving an object never returned by load is rejected, including cloned snapshots", async () => {
  const { store } = makeStore();
  const current = await store.load();
  await assert.rejects(store.save(current, structuredClone(current)),
    LearningStateWriteConflict);
});
