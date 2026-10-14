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
