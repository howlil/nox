import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { ProgramWriteConflict, VaultProgramStore } from "../../src/persistence/VaultProgramStore";

const PATH = "00-learning-os/programs.json";
const EMPTY = { version: 1 as const, programs: [] };

class MemoryVault {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readCalls = 0;
  cachedReadCalls = 0;
  beforeModify?: () => Promise<void>;

  getFileByPath(path: string) {
    return this.files.has(path) ? new TFile(path) : null;
  }
  getAbstractFileByPath(path: string) {
    return this.folders.has(path) ? { path } : null;
  }
  async read(file: TFile) {
    this.readCalls++;
    return this.files.get(file.path) ?? "";
  }
  async cachedRead(_file: TFile) {
    this.cachedReadCalls++;
    return "stale cached text";
  }
  async createFolder(path: string) {
    this.folders.add(path);
  }
  async create(path: string, content: string) {
    this.files.set(path, content);
    return new TFile(path);
  }
  async modify(file: TFile, content: string) {
    if (this.beforeModify) await this.beforeModify();
    this.files.set(file.path, content);
  }
  async process(file: TFile, change: (current: string) => string) {
    if (this.beforeModify) await this.beforeModify();
    const current = this.files.get(file.path);
    if (current === undefined) throw new Error("Vault file missing.");
    const next = change(current);
    this.files.set(file.path, next);
  }
}

test("missing program file returns the empty collection", async () => {
  const vault = new MemoryVault();
  const store = new VaultProgramStore({ vault } as never);
  assert.deepEqual(await store.load(), EMPTY);
});

test("malformed programs JSON fails safely without overwriting user data", async () => {
  const vault = new MemoryVault();
  vault.files.set(PATH, '{"version":1,"programs":');
  const store = new VaultProgramStore({ vault } as never);
  await assert.rejects(store.load(), /Invalid NOX programs JSON at 00-learning-os\/programs.json/);
  assert.equal(vault.files.get(PATH), '{"version":1,"programs":');
  assert.equal(vault.cachedReadCalls, 0);
  assert.equal(vault.readCalls, 1);
});

test("program loads use the authoritative vault read, not stale cached content", async () => {
  const vault = new MemoryVault();
  vault.files.set(PATH, JSON.stringify(EMPTY));
  const store = new VaultProgramStore({ vault } as never);
  assert.deepEqual(await store.load(), EMPTY);
  assert.equal(vault.cachedReadCalls, 0);
  assert.equal(vault.readCalls, 1);
});

test("program loads await an in-flight write before reading the snapshot", async () => {
  const vault = new MemoryVault();
  vault.files.set(PATH, '{"version":1,"programs":');
  let entered!: () => void;
  let release!: () => void;
  const modifyEntered = new Promise<void>(resolve => { entered = resolve; });
  const modificationGate = new Promise<void>(resolve => { release = resolve; });
  vault.beforeModify = async () => { entered(); await modificationGate; };
  const store = new VaultProgramStore({ vault } as never);
  const saving = store.save(EMPTY);
  await modifyEntered;
  const loading = store.load();
  await Promise.resolve();
  assert.equal(vault.readCalls, 0);
  release();
  await saving;
  assert.deepEqual(await loading, EMPTY);
  assert.equal(vault.readCalls, 1);
});

test("v1 program persists a focus using v2 and retains a verified legacy backup", async () => {
  const vault = new MemoryVault();
  vault.folders.add("00-learning-os");
  const initial = { version: 1 as const, activeProgramId: "p",
    programs: [{ version: 1 as const, id: "p", goal: "Concurrency", planVersion: 1,
      createdAt: 10, constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
        sourcePaths: [], sourceBound: false, excludedTopics: [] },
      objectives: [{ id: "race", title: "Race", outcome: "Explain a race",
        prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Interleaving"],
        sourceRefs: [], priority: "core" as const }] }] };
  vault.files.set(PATH, JSON.stringify(initial));
  const store = new VaultProgramStore({ vault } as never);
  const loaded = await store.load();
  loaded.programs[0].focus = { id: "focus-1", programId: "p", objectiveId: "race",
    curriculumRevision: 1, chatSessionId: "chat-1", status: "active", startedAt: 20 };
  await store.save(loaded);
  const restored = await store.load();
  assert.equal(restored.version, 2);
  assert.equal(restored.programs[0].version, 2);
  assert.equal(restored.programs[0].focus?.id, "focus-1");
  const backups = [...vault.files.entries()].filter(([path]) => path.endsWith(".backup.json"));
  assert.equal(backups.length, 1);
  assert.equal(backups[0][1], JSON.stringify(initial));
});

test("M2 revision persistence compares the exact snapshot against current vault bytes", async () => {
  const vault = new MemoryVault();
  vault.files.set(PATH, JSON.stringify({ version: 1, programs: [] }));
  const store = new VaultProgramStore({ vault } as never);
  const expected = await store.load();
  const next = structuredClone(expected);
  next.version = 2;
  await store.save(next, expected);
  assert.equal((await store.load()).version, 2);
  const stale = await store.load();
  const latestBytes = vault.files.get(PATH)!;
  vault.files.set(PATH, latestBytes.replace('"programs": []', '"programs":[]'));
  // Simulate a legitimate concurrent external write; do not silently overwrite it.
  vault.files.set(PATH, JSON.stringify({ version: 2, programs: [], external: "changed" }));
  await assert.rejects(store.save(stale, stale), /Program write conflict/);
  assert.equal(JSON.parse(vault.files.get(PATH)!).external, "changed");
});

test("M7 non-revision focus CAS rejects concurrent program edits without losing either snapshot", async () => {
  const vault = new MemoryVault();
  vault.folders.add("00-learning-os");
  const initial = { version: 2 as const, activeProgramId: "p",
    programs: [{ version: 2 as const, id: "p", goal: "Concurrent programs",
      createdAt: 10, planVersion: 1,
      constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
        sourcePaths: [], excludedTopics: [] },
      objectives: [{ id: "basics", title: "Basics", outcome: "Explain locks",
        prerequisiteIds: [], rubric: ["Explain locks"], estimatedMinutes: 30,
        sourceRefs: [], priority: "core" as const }] }],
  };
  vault.files.set(PATH, JSON.stringify(initial));
  const store = new VaultProgramStore({ vault } as never);
  const focusWriter = await store.load();
  const externalWriter = await store.load();
  externalWriter.programs[0].goal = "Updated by another writer";
  await store.save(externalWriter, externalWriter);
  focusWriter.programs[0].focus = { id: "focus", programId: "p", objectiveId: "basics",
    curriculumRevision: 1, chatSessionId: "chat", status: "active", startedAt: 12 };
  await assert.rejects(store.save(focusWriter, focusWriter), ProgramWriteConflict);
  const persisted = await store.load();
  assert.equal(persisted.programs[0].goal, "Updated by another writer");
  assert.equal(persisted.programs[0].focus, undefined);
  persisted.programs[0].focus = focusWriter.programs[0].focus;
  await store.save(persisted, persisted);
  const restored = await store.load();
  assert.equal(restored.programs[0].goal, "Updated by another writer");
  assert.equal(restored.programs[0].focus?.id, "focus");
});

test("M7 injected process failure preserves program bytes and later save remains available", async () => {
  const vault = new MemoryVault();
  vault.folders.add("00-learning-os");
  vault.files.set(PATH, JSON.stringify(EMPTY));
  const store = new VaultProgramStore({ vault } as never);
  const loaded = await store.load();
  const original = vault.files.get(PATH);
  vault.beforeModify = async () => { throw new Error("Disk unavailable"); };
  await assert.rejects(store.save(loaded, loaded), /Unable to save learning program/);
  assert.equal(vault.files.get(PATH), original);
  vault.beforeModify = undefined;
  const refreshed = await store.load();
  await store.save(refreshed, refreshed);
  assert.deepEqual(await store.load(), EMPTY);
});
