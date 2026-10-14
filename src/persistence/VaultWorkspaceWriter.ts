import { App, TFile, TFolder } from "obsidian";
import type { LearningProgram } from "../domain/learning-program/types";
import { planWorkspace } from "../domain/workspace/plan";

/** Reentrant create-only writer. Partial failures can safely retry after restart. */
export class VaultWorkspaceWriter {
  constructor(private readonly app: App) {}

  /** Materialize only the selected objective, never an entire speculative curriculum. */
  async ensureObjective(program: LearningProgram, objectiveId: string): Promise<void> {
    if (program.constraints.sourceBound) return; // Respect the learner's original source notes.
    const objective = program.objectives.find(item => item.id === objectiveId);
    if (!objective) throw new Error("Unknown learning objective.");
    await this.ensure(program);
    const root = planWorkspace(program).root;
    const path = `${root}/Lessons/${objective.id}.md`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (!(existing instanceof TFile)) throw new Error("Lesson path is not a file.");
      const content = await this.app.vault.read(existing);
      if (!content.includes(`nox-program-id: "${program.id}"`) ||
          !content.includes(`nox-objective-id: "${objective.id}"`)) {
        throw new Error("Lesson path conflicts with an unowned note.");
      }
      return; // Never rewrite a learner-modified note.
    }
    const text = [
      "---",
      `nox-program-id: "${program.id}"`,
      `nox-objective-id: "${objective.id}"`,
      "---",
      `# ${objective.title.replace(/[\\r\\n#]/g, " ")}`,
      "",
      "## Learning outcome",
      objective.outcome,
      "",
      "## Success criteria",
      ...objective.rubric.map(item => "- " + item),
      "",
      "## Study notes",
      "Add your notes here as you learn with NOX.",
      "",
    ].join("\n");
    await this.app.vault.create(path, text);
  }

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
