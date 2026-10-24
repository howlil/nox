import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TFile } from "obsidian";
import { FileWorkspace } from "../../headless/src/FileWorkspace";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";
import { VaultLearningStore } from "../../src/persistence/VaultLearningStore";
import { VaultProgramStore } from "../../src/persistence/VaultProgramStore";
import { ProgramWriteConflict } from "../../src/domain/persistence/errors";
import { LearningStateWriteConflict } from "../../src/domain/persistence/errors";
import { createObsidianLearningHost } from "../../src/host/obsidian/composition";
import type { SessionDataPort } from "../../src/types";
import type { LearningStatePort, ProgramStorePort } from "../../src/application/ports";
import type { ProgramCollection } from "../../src/domain/learning-program/types";

async function sessionContract(create: () => Promise<{ store: SessionDataPort; close: () => Promise<void> }>) {
  const host = await create();
  try {
    const { store } = host;
    const first = store.update(current => ({
      ...current, "nox-settings": { provider: "agy" },
    }));
    const second = store.update(current => ({
      ...current, "nox-sessions": { currentSessionId: "s1" },
    }));
    await Promise.all([first, second]);
    assert.deepEqual(await store.read(), {
      "nox-settings": { provider: "agy" },
      "nox-sessions": { currentSessionId: "s1" },
    });
    await assert.rejects(store.update(() => { throw new Error("injected failure"); }),
      /injected failure/);
    assert.deepEqual(Object.keys(await store.read()).sort(),
      ["nox-sessions", "nox-settings"]);
    await store.update(current => ({
      ...current, "nox-sessions": { currentSessionId: "s2" },
    }));
    assert.deepEqual((await store.read())["nox-settings"], { provider: "agy" });
    assert.deepEqual((await store.read())["nox-sessions"], { currentSessionId: "s2" });
  } finally {
    await host.close();
  }
}

test("M3 same session-port conformance runs against Obsidian and Node hosts", async () => {
  await sessionContract(async () => {
    let data: Record<string, unknown> = {};
    const store = new PluginDataRepository({
      loadData: async () => structuredClone(data),
      saveData: async next => { data = structuredClone(next as Record<string, unknown>); },
    } as never);
    return { store, close: async () => {} };
  });

  const directory = await mkdtemp(join(tmpdir(), "nox-m3-sessions-"));
  try {
    await sessionContract(async () => {
      const workspace = await FileWorkspace.open(directory);
      return { store: workspace.sessionData, close: () => workspace.close() };
    });
    // The separate host retains the same durable keys after reopening.
    const reopened = await FileWorkspace.open(directory);
    try {
      assert.deepEqual((await reopened.sessionData.read())["nox-sessions"],
        { currentSessionId: "s2" });
    } finally { await reopened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

class MemoryVault {
  files = new Map<string, string>();
  folders = new Set<string>();
  getFileByPath(path: string): TFile | null {
    return this.files.has(path) ? new TFile(path) : null;
  }
  getAbstractFileByPath(path: string): { path: string } | null {
    return this.folders.has(path) ? { path } : null;
  }
  async createFolder(path: string): Promise<void> { this.folders.add(path); }
  async create(path: string, data: string): Promise<TFile> {
    if (this.files.has(path)) throw new Error("Already exists");
    this.files.set(path, data);
    return new TFile(path);
  }
  async read(file: TFile): Promise<string> { return this.files.get(file.path)!; }
  async process(file: TFile, mutate: (before: string) => string): Promise<void> {
    this.files.set(file.path, mutate(await this.read(file)));
  }
  async modify(file: TFile, data: string): Promise<void> { this.files.set(file.path, data); }
}

async function evidenceContract(store: LearningStatePort): Promise<void> {
  const first = await store.load();
  const concurrent = await store.load();
  assert.equal(first.evidence.length, 0);
  await store.save({ ...first, target: "committed" }, first);
  await assert.rejects(
    store.save({ ...concurrent, target: "overwritten" }, concurrent),
    LearningStateWriteConflict,
  );
  assert.equal((await store.load()).target, "committed");
  const fresh = await store.load();
  await store.save({ ...fresh, target: "retry" }, fresh);
  assert.equal((await store.load()).target, "retry");
}

test("M3 identical evidence-CAS contract works on real Obsidian and headless stores", async () => {
  const vault = new MemoryVault();
  await evidenceContract(new VaultLearningStore({ vault } as never));
  const directory = await mkdtemp(join(tmpdir(), "nox-m3-evidence-"));
  try {
    const workspace = await FileWorkspace.open(directory);
    try { await evidenceContract(workspace.learningState); }
    finally { await workspace.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("M3 Obsidian factory reuses one plugin writer and never discovers models on load", async () => {
  let data: Record<string, unknown> = { "nox-settings": { provider: "agy" } };
  let writes = 0;
  let discovery = 0;
  const plugin = {
    loadData: async () => structuredClone(data),
    saveData: async (next: Record<string, unknown>) => {
      writes++;
      data = structuredClone(next);
    },
    registerEvent: () => {},
  };
  const workspaceEvents: string[] = [];
  const app = {
    workspace: {
      getActiveViewOfType: () => null,
      on: (name: string) => { workspaceEvents.push(name); return {}; },
    },
    vault: { on: () => ({}), getFileByPath: () => null },
  };
  const writer = new PluginDataRepository(plugin as never);
  const adapter = {
    check: async () => ({ status: "ready" as const }),
    listModels: async () => { discovery++; return []; },
    send: async function* () { yield { type: "completed" as const }; },
  };
  const host = await createObsidianLearningHost({
    plugin: plugin as never, app: app as never, data: writer, adapter,
    provider: "agy", preferredModel: "model-a", onUsage: undefined,
  });
  try {
    assert.equal(host.learning.getSession().id, host.sessions.getSession().id);
    assert.equal(host.sessions.getSession().model, "model-a");
    assert.equal(discovery, 0, "startup may not execute CLI/model discovery");
    assert.ok(writes > 0, "all session writes use the provided plugin-data owner");
    assert.deepEqual(data["nox-settings"], { provider: "agy" });
    assert.ok(workspaceEvents.includes("file-open"),
      "Obsidian context listeners must be registered with the owning plugin");
  } finally { host.learning.dispose(); host.runtime.dispose(); }
});

/** The same read/modify/write and schema-upgrade contract on two real host adapters. */
async function sharedProgramContract(store: ProgramStorePort): Promise<void> {
  const initial = await store.load();
  const stale = await store.load();
  const program: ProgramCollection["programs"][number] = {
    version: 1, id: "portable-program", goal: "Learn transactions",
    createdAt: Date.now(), planVersion: 1,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
      sourcePaths: [], sourceBound: false, excludedTopics: [] },
    objectives: [{ id: "atomicity", title: "Atomicity", outcome: "Explain atomic commits",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain atomic commits"],
      sourceRefs: [], priority: "core" }],
  };
  await store.save({ version: 1, activeProgramId: program.id,
    programs: [program] }, initial);
  await assert.rejects(store.save({ version: 1, programs: [] }), ProgramWriteConflict);
  await assert.rejects(store.save({ version: 1, programs: [] }, stale), ProgramWriteConflict);
  const fresh = await store.load();
  const next = structuredClone(fresh);
  next.programs[0].focus = {
    id: "focus", programId: program.id, objectiveId: "atomicity",
    curriculumRevision: 1, chatSessionId: "session-a",
    status: "active", startedAt: Date.now(),
  };
  await store.save(next, fresh);
  const upgraded = await store.load();
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.programs[0].version, 2);
  assert.equal(upgraded.programs[0].focus?.status, "active");
  assert.equal(upgraded.activeProgramId, program.id);
}

test("M8 Obsidian and headless program stores share CAS, focus and v2 upgrade semantics", async () => {
  await sharedProgramContract(new VaultProgramStore({ vault: new MemoryVault() } as never));
  const directory = await mkdtemp(join(tmpdir(), "nox-m8-host-conformance-"));
  try {
    const workspace = await FileWorkspace.open(directory);
    try { await sharedProgramContract(workspace.programs); }
    finally { await workspace.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
