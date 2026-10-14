import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { VaultProgramStore } from "../../src/persistence/VaultProgramStore";

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
