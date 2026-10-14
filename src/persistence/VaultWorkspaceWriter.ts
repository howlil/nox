import { App, TFile, TFolder } from "obsidian";
import type { LearningProgram } from "../domain/learning-program/types";
import { planWorkspace } from "../domain/workspace/plan";

/** Reentrant create-only writer. Partial failures can safely retry after restart. */
export class VaultWorkspaceWriter {
  constructor(private readonly app: App) {}

  async ensure(program: LearningProgram): Promise<void> {
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
