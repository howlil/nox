import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { VaultLearningStore } from "../../src/persistence/VaultLearningStore";
import { projectLearnerModel } from "../../src/domain/learner-model/learner-memory";
import type { LearningProgram } from "../../src/domain/learning-program/types";

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
    version: 3,
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
  assert.deepEqual(await store.load(), { ...state, version: 3 });
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

test("learner memory reconstructs from canonical progress after restart without memory.json", async () => {
  const { vault, store } = makeStore();
  const program: LearningProgram = {
    id: "p", version: 1, planVersion: 1, goal: "Master transactions", createdAt: 1,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
      sourceBound: false, sourcePaths: [], excludedTopics: [] },
    objectives: [{ id: "transactions", title: "Transactions", outcome: "Explain locking",
      prerequisiteIds: [], estimatedMinutes: 45, priority: "core",
      sourceRefs: [], rubric: ["Explain locking"],
      criteria: [{ id: "c1", description: "Explain locking", required: true }] }],
  };
  const oldEvidence = {
    id: "attempt-1", type: "practice" as const, scope: "learner" as const,
    programId: "p", objectiveId: "transactions", objectiveRevision: 1,
    concept: "Locking", source: "lesson.md", createdAt: 100,
    outcome: "incorrect", taskKind: "diagnostic" as const,
    rubricResults: [{ criterion: "Explain locking", criterionId: "c1",
      met: false, evidence: "No invariant" }],
  };
  await store.save({ version: 3, target: null, gaps: [], evidence: [oldEvidence] });
  const fromDisk = new VaultLearningStore({ vault } as never);
  const before = projectLearnerModel(program, (await fromDisk.load()).evidence, [], 500);
  assert.equal(before.objectives.transactions.criteria[0].status, "needs-repair");
  assert.equal(before.objectives.transactions.attempts, 1);
  await fromDisk.save({ version: 3, target: null, gaps: [], evidence: [
    oldEvidence, { ...oldEvidence, id: "attempt-2", createdAt: 200,
      outcome: "correct", taskKind: "guided-practice",
      rubricResults: [{ ...oldEvidence.rubricResults[0], met: true }] },
  ] });
  const after = projectLearnerModel(program, (await store.load()).evidence, [], 500);
  assert.notEqual(after.evidenceRevision, before.evidenceRevision);
  assert.equal(after.objectives.transactions.attempts, 2);
  assert.equal(vault.files.has("00-learning-os/memory.json"), false);
});
