import { App, MarkdownView, TFile } from "obsidian";
import { ApplyResult, EditProposal } from "../types";
import { planReplacement } from "../domain/mutation/replacement";

/**
 * Owns user-approved Markdown mutations.
 *
 * Nox v1 only mutates the active turn's primary Markdown note through an
 * open Obsidian editor. Supporting notes remain read-only context so Apply
 * always participates in native editor history and Ctrl/Cmd+Z remains valid.
 */
export class MutationService {
  constructor(private readonly app: App) {}

  async apply(
    proposal: EditProposal,
    mutableFile?: string,
  ): Promise<ApplyResult> {
    if (!mutableFile || proposal.file !== mutableFile) {
      return {
        ok: false,
        reason: "unauthorized",
        message:
          "Nox can only edit the primary note used for this turn.",
      };
    }

    const file = this.app.vault.getFileByPath(proposal.file);

    if (!file || !(file instanceof TFile)) {
      return {
        ok: false,
        reason: "missing-file",
        message: `Target note not found: ${proposal.file}`,
      };
    }

    try {
      const targetView = this.findOpenMarkdownView(file.path);

      if (!targetView) {
        return {
          ok: false,
          reason: "no-editor",
          message:
            "Open the target note in an editor before applying this change.",
        };
      }

      const editor = targetView.editor;
      const content = editor.getValue();
      const plan = planReplacement(
        content,
        proposal.original,
        proposal.replacement,
      );

      if (!plan.ok && plan.reason === "stale") {
        return {
          ok: false,
          reason: "stale",
          message:
            "Note changed since the proposal was made. Regenerate the edit.",
        };
      }

      if (!plan.ok) {
        return {
          ok: false,
          reason: "ambiguous",
          message:
            "The original text occurs more than once. Regenerate with a more specific selection.",
        };
      }

      const from = editor.offsetToPos(plan.index);
      const to = editor.offsetToPos(
        plan.index + proposal.original.length,
      );

      editor.replaceRange(proposal.replacement, from, to);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: "error",
        message:
          error instanceof Error
            ? error.message
            : String(error),
      };
    }
  }

  private findOpenMarkdownView(
    path: string,
  ): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (
        leaf.view instanceof MarkdownView &&
        leaf.view.file?.path === path
      ) {
        return leaf.view;
      }
    }

    return null;
  }
}
