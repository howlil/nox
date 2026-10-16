import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { VaultProgramStore } from "../../src/persistence/VaultProgramStore";
import { VaultLearningStore } from "../../src/persistence/VaultLearningStore";
import { objectiveProgress } from "../../src/domain/learning-program/rules";
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
