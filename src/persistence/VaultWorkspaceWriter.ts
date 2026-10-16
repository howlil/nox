import { App, TFile, TFolder } from "obsidian";
import type { CurriculumRevisionRecord, LearningProgram } from "../domain/learning-program/types";
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

  /** Never rewrite Roadmap.md or a learner-edited lesson. New revisions are standalone snapshots. */
  async ensureRevision(program: LearningProgram, revision: CurriculumRevisionRecord): Promise<void> {
    if (!program.workspaceApproved || program.constraints.sourceBound) return;
    if (revision.toVersion !== program.planVersion ||
        !program.curriculumRevisions?.some(item => item.operationId === revision.operationId)) {
      throw new Error("Cannot materialize a revision that is not committed.");
    }
    await this.ensure(program);
    const root = planWorkspace(program).root;
    const path = `${root}/Roadmap-v${revision.toVersion}.md`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (!(existing instanceof TFile)) throw new Error("Revision roadmap path is not a file.");
      const content = await this.app.vault.read(existing);
      if (!content.includes(`nox-program-id: "${program.id}"`) ||
          !content.includes(`nox-revision-operation: "${revision.operationId}"`)) {
        throw new Error("Revision roadmap path conflicts with an unowned note.");
      }
    } else {
      const roadmap = [
        "---",
        `nox-program-id: "${program.id}"`,
        `nox-revision-operation: "${revision.operationId}"`,
        `nox-plan-version: ${revision.toVersion}`,
        "---",
        `# Curriculum revision ${revision.toVersion}`,
        "",
        `Evidence: ${revision.reasonEvidenceIds.join(", ")}`,
        "",
        "## Updated objectives",
        ...program.objectives.map(item => `- **${item.title.replace(/[\r\n]/g, " ")}**${item.deprecated ? " (retired)" : ""} — ${item.outcome.replace(/[\r\n]/g, " ")}`),
        "",
        "Previous roadmap and your lesson notes have not been overwritten.",
        "",
      ].join("\n");
      await this.app.vault.create(path, roadmap);
    }
    if (revision.kind === "prerequisite-remediation" && revision.addedObjectiveId) {
      await this.ensureObjective(program, revision.addedObjectiveId);
    }
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
