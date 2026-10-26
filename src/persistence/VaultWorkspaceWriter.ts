import { App, TFile, TFolder } from "obsidian";
import { planWorkspace, planObjectiveLesson, type LearningProgram } from "@nox/core";

/** Reentrant create-only writer. Partial failures can safely retry after restart. */
export class VaultWorkspaceWriter {
  private readonly inflight = new Map<string, Promise<void>>();
  constructor(private readonly app: App) {}

  /** Materialize only the selected objective, never an entire speculative curriculum. */
  async ensureObjective(program: LearningProgram, objectiveId: string): Promise<void> {
    if (program.constraints.sourceBound) return; // Respect the learner's original source notes.
    const lesson = planObjectiveLesson(program, objectiveId);
    await this.ensure(program);
    const path = lesson.path;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (!(existing instanceof TFile)) throw new Error("Lesson path is not a file.");
      const content = await this.app.vault.read(existing);
      if (!content.includes(`nox-program-id: "${program.id}"`) ||
          !content.includes(`nox-objective-id: "${objectiveId}"`)) {
        throw new Error("Lesson path conflicts with an unowned note.");
      }
      return; // Never rewrite a learner-modified note.
    }
    await this.app.vault.create(path, lesson.content);
  }

  async ensure(program: LearningProgram): Promise<void> {
    const current = this.inflight.get(program.id);
    if (current) return current;
    const work = this.materialize(program);
    this.inflight.set(program.id, work);
    try { await work; }
    finally {
      if (this.inflight.get(program.id) === work) this.inflight.delete(program.id);
    }
  }

  private async materialize(program: LearningProgram): Promise<void> {
    const manifest = planWorkspace(program);
    for (const folder of manifest.folders) {
      const existing = this.app.vault.getAbstractFileByPath(folder);
      if (existing && !(existing instanceof TFolder)) {
        throw new Error(`Workspace path is occupied by a file: ${folder}`);
      }
      if (!existing) await this.app.vault.createFolder(folder);
    }
    for (const candidate of manifest.files) {
      const existing = this.app.vault.getAbstractFileByPath(candidate.path);
      if (existing && !(existing instanceof TFile)) {
        throw new Error(`Workspace note path is occupied by a folder: ${candidate.path}`);
      }
      if (existing instanceof TFile) {
        // Never overwrite a learner's edited note. Confirm ownership before treating as retried.
        const content = await this.app.vault.read(existing);
        if (!content.includes(`nox-program-id: "${program.id}"`)) {
          throw new Error(`Workspace note collision: ${candidate.path}`);
        }
      } else {
        await this.app.vault.create(candidate.path, candidate.content);
      }
    }
  }
}
