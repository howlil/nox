import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { VaultWorkspaceWriter } from "../../src/persistence/VaultWorkspaceWriter";
import type { LearningProgram } from "../../src/domain/learning-program/types";
import { planWorkspace } from "../../src/domain/workspace/plan";

const program: LearningProgram = {
  version: 1, id: "11111111-1111-4111-8111-111111111111",
  goal: "Learn conversational Japanese", createdAt: Date.now(), planVersion: 1,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
    sourcePaths: [], excludedTopics: [] },
  objectives: [{ id: "greetings", title: "Greetings", outcome: "Introduce yourself",
    prerequisiteIds: [], estimatedMinutes: 40, rubric: ["Introduce yourself in context"],
    sourceRefs: [], priority: "core" }],
};
class FakeVault {
  files = new Map<string, string>();
  folders = new Set<string>();
  creates = 0;
  failureAt?: number;
  getAbstractFileByPath(path: string) {
    return this.files.has(path) ? new TFile(path) :
      this.folders.has(path) ? new TFolder(path) : null;
  }
  async read(file: TFile) { return this.files.get(file.path) ?? ""; }
  async createFolder(path: string) {
    this.folders.add(path);
  }
  async create(path: string, content: string) {
    this.creates++;
    if (this.failureAt === this.creates) throw new Error("disk failed");
    if (this.files.has(path)) throw new Error("conflict");
    this.files.set(path, content);
    return new TFile(path);
  }
}
test("workspace creates only manifest notes and retry is idempotent", async () => {
  const vault = new FakeVault();
  const writer = new VaultWorkspaceWriter({ vault } as never);
  await writer.ensure(program);
  const before = vault.creates;
  await writer.ensure(program);
  assert.equal(vault.creates, before);
  assert.equal(vault.files.size, 2);
  const p = planWorkspace(program).files[0].path;
  vault.files.set(p, vault.files.get(p)! + "\nMy personal notes");
  await writer.ensure(program);
  assert.match(vault.files.get(p)!, /My personal notes/);
});
test("partial filesystem failure retries without overwriting the first note", async () => {
  const vault = new FakeVault();
  vault.failureAt = 2;
  const writer = new VaultWorkspaceWriter({ vault } as never);
  await assert.rejects(writer.ensure(program), /disk failed/);
  assert.equal(vault.files.size, 1);
  vault.failureAt = undefined;
  await writer.ensure(program);
  assert.equal(vault.files.size, 2);
});
test("unowned preexisting note causes conflict without overwrite", async () => {
  const vault = new FakeVault();
  const p = planWorkspace(program).files[0].path;
  vault.files.set(p, "Someone else's note");
  const writer = new VaultWorkspaceWriter({ vault } as never);
  await assert.rejects(writer.ensure(program), /collision/);
  assert.equal(vault.files.get(p), "Someone else's note");
});

test("objective notes materialize on demand without overwriting learner notes", async () => {
  const vault = new FakeVault();
  const writer = new VaultWorkspaceWriter({ vault } as never);
  await writer.ensure(program);
  const before = vault.files.size;
  await writer.ensureObjective(program, "greetings");
  assert.equal(vault.files.size, before + 1);
  const lesson = planWorkspace(program).root + "/Lessons/greetings.md";
  assert.match(vault.files.get(lesson)!, /Learning outcome/);
  vault.files.set(lesson, vault.files.get(lesson)! + "\nUser notes");
  await writer.ensureObjective(program, "greetings");
  assert.match(vault.files.get(lesson)!, /User notes/);
});


test("approved revision creates an independent roadmap and remedial lesson without overwriting notes", async () => {
  const vault = new FakeVault();
  const writer = new VaultWorkspaceWriter({ vault } as never);
  const revision = {
    operationId: "repair:greetings:0", fromVersion: 1, toVersion: 2,
    kind: "prerequisite-remediation" as const,
    reasonEvidenceIds: ["q1", "q2"], addedObjectiveId: "greetings-repair-1",
  };
  const revised: LearningProgram = { ...program, planVersion: 2,
    workspaceApproved: true,
    curriculumRevisions: [revision],
    objectives: [
      { ...program.objectives[0], prerequisiteIds: ["greetings-repair-1"] },
      { id: "greetings-repair-1", title: "Repair greetings",
        outcome: "Explain independently", prerequisiteIds: [],
        estimatedMinutes: 30, rubric: ["Introduce yourself in context"],
        sourceRefs: [], priority: "supporting" },
    ] };
  await writer.ensure(program);
  const originalRoadmap = planWorkspace(program).files.find(item => item.path.endsWith("Roadmap.md"))!.path;
  vault.files.set(originalRoadmap, vault.files.get(originalRoadmap)! + "\nLearner additions");
  const original = vault.files.get(originalRoadmap);
  const root = planWorkspace(program).root;
  const revisionPath = root + "/Roadmap-v2.md";
  const lesson = root + "/Lessons/greetings-repair-1.md";
  vault.failureAt = vault.creates + 2;
  await assert.rejects(writer.ensureRevision(revised, revision), /disk failed/);
  assert.ok(vault.files.has(revisionPath), "committed snapshot can survive partial note failure");
  assert.equal(vault.files.has(lesson), false);
  vault.failureAt = undefined;
  const savedSnapshot = vault.files.get(revisionPath);
  await writer.ensureRevision(revised, revision);
  assert.equal(vault.files.get(revisionPath), savedSnapshot);
  assert.match(vault.files.get(lesson)!, /nox-objective-id: "greetings-repair-1"/);
  assert.equal(vault.files.get(originalRoadmap), original);
  const fileCount = vault.files.size;
  await writer.ensureRevision(revised, revision);
  assert.equal(vault.files.size, fileCount);
  vault.files.set(revisionPath, "An unrelated note");
  await assert.rejects(writer.ensureRevision(revised, revision), /conflicts with an unowned note/);
  assert.equal(vault.files.get(revisionPath), "An unrelated note");
});

test("source-bound and unapproved revisions never materialize speculative notes", async () => {
  const vault = new FakeVault();
  const writer = new VaultWorkspaceWriter({ vault } as never);
  const revision = {
    operationId: "repair:greetings:0", fromVersion: 1, toVersion: 2,
    kind: "prerequisite-remediation" as const,
    reasonEvidenceIds: ["q1", "q2"], addedObjectiveId: "greetings-repair-1",
  };
  const sourceBound: LearningProgram = { ...program, planVersion: 2,
    workspaceApproved: true, curriculumRevisions: [revision],
    constraints: { ...program.constraints, sourceBound: true, sourcePaths: ["notes.md"] } };
  await writer.ensureRevision(sourceBound, revision);
  await writer.ensureRevision({ ...sourceBound, workspaceApproved: false,
    constraints: { ...program.constraints } }, revision);
  assert.equal(vault.files.size, 0);
  assert.equal(vault.creates, 0);
});
