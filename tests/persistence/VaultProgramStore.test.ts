import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { VaultProgramStore } from "../../src/persistence/VaultProgramStore";
import { VaultLearningStore } from "../../src/persistence/VaultLearningStore";
import { objectiveProgress } from "../../src/domain/learning-program/rules";
import { applyStructuralRevision } from "../../src/domain/learning-program/structural-revision";
import type { LearningProgram } from "../../src/domain/learning-program/types";

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
  async cachedRead(file: TFile) {
    this.cachedReadCalls++;
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
    if (this.beforeModify) await this.beforeModify();
    this.files.set(file.path, content);
  }
  async process(file: TFile, modify: (contents: string) => string) {
    if (this.beforeModify) await this.beforeModify();
    const original = this.files.get(file.path) ?? "";
    const updated = modify(original);
    this.files.set(file.path, updated);
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
  vault.files.set(PATH, JSON.stringify(EMPTY));
  let entered!: () => void;
  let release!: () => void;
  const modifyEntered = new Promise<void>(resolve => { entered = resolve; });
  const modificationGate = new Promise<void>(resolve => { release = resolve; });
  vault.beforeModify = async () => { entered(); await modificationGate; };
  const store = new VaultProgramStore({ vault } as never);
  const updated = await store.load();
  vault.readCalls = 0;
  const saving = store.save(updated);
  await modifyEntered;
  const loading = store.load();
  await Promise.resolve();
  assert.equal(vault.readCalls, 0);
  release();
  await saving;
  assert.deepEqual(await loading, EMPTY);
  assert.equal(vault.readCalls, 1);
});


test("vault reload preserves mastery across rubric rewording only when stable criterion identity survives", async () => {
  const vault = new MemoryVault();
  const programs = new VaultProgramStore({ vault } as never);
  const learning = new VaultLearningStore({ vault } as never);
  const now = Date.UTC(2026, 9, 16, 10);
  const original: LearningProgram = {
    version: 1, id: "p", goal: "Learn safety", planVersion: 1, createdAt: now,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
      sourcePaths: [], sourceBound: false, excludedTopics: [] },
    objectives: [{ id: "o", title: "Safety", outcome: "Explain invariants",
      prerequisiteIds: [], estimatedMinutes: 30,
      rubric: ["Explain invariant"],
      criteria: [{ id: "stable-c1", description: "Explain invariant", required: true }],
      sourceRefs: [], priority: "core" }],
  };
  const first = { id: "first", type: "practice" as const, scope: "learner" as const,
    programId: "p", objectiveId: "o", objectiveRevision: 1,
    concept: "Invariants", source: "lesson.md", outcome: "correct",
    createdAt: now - 2 * 86_400_000, taskKind: "guided-practice" as const,
    rubricResults: [{ criterion: "Explain invariant", criterionId: "stable-c1",
      met: true, evidence: "Explained" }] };
  const second = { ...first, id: "recall", createdAt: now, taskKind: "recall" as const };
  await programs.save({ version: 1, activeProgramId: "p", programs: [original] });
  await learning.save({ version: 3, target: null, gaps: [], evidence: [first, second] });
  assert.equal(objectiveProgress((await programs.load()).programs[0],
    "o", (await learning.load()).evidence, now).status, "mastered");

  const reworded = structuredClone(original);
  reworded.planVersion = 2;
  reworded.objectives[0].rubric = ["Explain the invariant precisely"];
  reworded.objectives[0].criteria![0].description = "Explain the invariant precisely";
  await programs.save({ version: 1, activeProgramId: "p", programs: [reworded] });
  const saved = await learning.load();
  assert.equal(objectiveProgress((await programs.load()).programs[0],
    "o", saved.evidence, now).status, "mastered");
  assert.equal(saved.evidence[0].rubricResults?.[0].criterion, "Explain invariant",
    "persisted evidence is never rewritten to match new rubric text");

  reworded.objectives[0].criteria![0].id = "meaning-changed";
  await programs.save({ version: 1, activeProgramId: "p", programs: [reworded] });
  assert.equal(objectiveProgress((await programs.load()).programs[0],
    "o", saved.evidence, now).status, "remediate");
});


test("programs.json round-trips approved structural lineage and retains objective tombstones", async () => {
  const vault = new MemoryVault();
  const store = new VaultProgramStore({ vault } as never);
  const created = Date.UTC(2026, 9, 16);
  const original: LearningProgram = {
    version: 1, id: "p", goal: "Learn SQL", createdAt: created,
    planVersion: 1, constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
      sourcePaths: [], sourceBound: false, excludedTopics: [] },
    objectives: [{ id: "sql", title: "SQL", outcome: "Understand queries",
      prerequisiteIds: [], estimatedMinutes: 30,
      rubric: ["Write basic SQL"], sourceRefs: [], priority: "core",
      criteria: [{ id: "c1", description: "Write basic SQL", required: true }] }],
  };
  const revision = applyStructuralRevision(original, {
    operationId: "manual:deprecate:1", programId: original.id, baseVersion: 1,
    rationale: "This objective has been superseded",
    action: { kind: "deprecate", objectiveId: "sql" },
  });
  await store.save({ version: 1, programs: [revision], activeProgramId: "p" });
  const loaded = await store.load();
  assert.equal(loaded.programs[0].planVersion, 2);
  assert.equal(loaded.programs[0].objectives[0].deprecated, true);
  assert.equal(loaded.programs[0].curriculumRevisions?.[0].kind, "deprecate");
  assert.deepEqual(loaded.programs[0].curriculumRevisions?.[0].before,
    original.objectives[0]);
  assert.deepEqual(loaded.programs[0].curriculumRevisions?.[0].after,
    revision.objectives[0]);
  const damaged = structuredClone(revision);
  damaged.curriculumRevisions![0].fromVersion = 88;
  await assert.rejects(store.save({
    version: 1, activeProgramId: "p", programs: [damaged],
  }), /revision history|lineage/);
  assert.equal((await store.load()).programs[0].planVersion, 2);
});

test("deferred notes survive vault reload; malformed records never overwrite files", async () => {
  const vault = new MemoryVault();
  const store = new VaultProgramStore({ vault } as never);
  const program: LearningProgram = {
    version: 1, id: "p", goal: "Learn locks", createdAt: 100, planVersion: 1,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
      sourceBound: false, sourcePaths: [], excludedTopics: [] },
    objectives: [{ id: "locks", title: "Locks", outcome: "Explain concurrency",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain a lock"],
      sourceRefs: [], priority: "core" }],
    deferredNotes: [{ id: "note:1", focusSessionId: "focus:1",
      objectiveId: "locks", createdAt: 150, text: "Review deadlocks later" }],
  };
  await store.save({ version: 1, activeProgramId: "p", programs: [program] });
  const reloaded = new VaultProgramStore({ vault } as never);
  assert.deepEqual((await reloaded.load()).programs[0].deferredNotes, program.deferredNotes);
  const durable = vault.files.get(PATH);
  const malformed = structuredClone(program);
  malformed.deferredNotes![0].objectiveId = "missing";
  await assert.rejects(reloaded.save({
    version: 1, activeProgramId: "p", programs: [malformed],
  }), /Invalid deferred learning note/);
  assert.equal(vault.files.get(PATH), durable);
  const legacy = structuredClone(program);
  delete legacy.deferredNotes;
  await reloaded.save({ version: 1, activeProgramId: "p", programs: [legacy] });
  assert.equal((await reloaded.load()).programs[0].deferredNotes, undefined);
});


test("CAS rejects a stale snapshot instead of overwriting another program writer", async () => {
  const vault = new MemoryVault();
  const one = new VaultProgramStore({ vault } as never);
  const two = new VaultProgramStore({ vault } as never);
  await one.save(EMPTY);
  const first = await one.load();
  const stale = await two.load();
  first.programs.push({
    version: 1, id: "p", goal: "Learn SQL", createdAt: Date.now(), planVersion: 1,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
      sourcePaths: [], sourceBound: false, excludedTopics: [] },
    objectives: [{ id: "sql", title: "SQL", outcome: "Explain queries",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain SELECT"],
      sourceRefs: [], priority: "core" }],
  });
  first.activeProgramId = "p";
  await one.save(first);
  const durable = vault.files.get(PATH);
  await assert.rejects(two.save(stale), /Program write conflict/);
  assert.equal(vault.files.get(PATH), durable,
    "stale writer must not overwrite a successfully committed state");
  const refreshed = await two.load();
  await two.save(refreshed);
});

test("CAS rejects a file changed externally after load, without deleting original bytes", async () => {
  const vault = new MemoryVault();
  const store = new VaultProgramStore({ vault } as never);
  await store.save(EMPTY);
  const snapshot = await store.load();
  const otherWriter = JSON.stringify(EMPTY) + "\nexternal formatting\n";
  vault.files.set(PATH, otherWriter);
  await assert.rejects(store.save(snapshot), /Program write conflict/);
  assert.equal(vault.files.get(PATH), otherWriter);
});

test("failed atomic process retains old bytes and permits explicitly retried snapshot", async () => {
  const vault = new MemoryVault();
  const store = new VaultProgramStore({ vault } as never);
  await store.save(EMPTY);
  const snapshot = await store.load();
  const previousBytes = vault.files.get(PATH);
  vault.beforeModify = async () => { throw new Error("disk failure"); };
  await assert.rejects(store.save(snapshot), /Unable to save learning program/);
  assert.equal(vault.files.get(PATH), previousBytes);
  vault.beforeModify = undefined;
  await store.save(snapshot);
  assert.equal((await store.load()).version, 1);
});
