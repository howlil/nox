import type { ChatMessage, EditProposal, ApplyResult } from "../types";
import type { ProposedEdit } from "../application/learning-types";
import { createNoxButton, createNoxSurface, createNoxStatus } from "./primitives";

/** Native view owns durable mutation authority; this presenter owns only the proposal DOM. */
export interface ProposalUiPort {
  reject(id: string): Promise<void>;
  apply(id: string): Promise<ApplyResult>;
  retryStatus(id: string): Promise<ApplyResult>;
  setState(next: "ANSWER" | "APPLIED"): void;
  reportError(parent: HTMLElement, message: string): void;
  scroll(): void;
}

/** Presentation and local pending state only. Never writes vault data directly. */
export class ProposalPresenter {
  constructor(private readonly thread: HTMLElement, private readonly port: ProposalUiPort) {}

  restore(message: ChatMessage): void { this.appendRestoredProposal(message); }
  append(edit: ProposedEdit): void { this.appendProposalBubble(edit); }

  private appendRestoredProposal(message: ChatMessage): void {
    const proposal = message.proposal;
    if (!proposal) return;
    const wrap = this.renderProposal(proposal);
    const state = message.proposalState ?? "stale";

    if (state === "pending" && message.proposalId) {
      this.appendProposalActions(wrap, {
        id: message.proposalId,
        proposal,
      });
      return;
    }

    const labels: Record<"applied" | "rejected" | "stale", string> = {
      applied: `✓ Applied to ${proposal.file}`,
      rejected: "✕ Rejected",
      stale: "⚠ Expired after restart",
    };
    const settledState = state === "applied" || state === "rejected"
      ? state
      : "stale";
    const resultKind = settledState === "applied"
      ? "success"
      : settledState === "rejected"
        ? "neutral"
        : "warning";
    createNoxStatus(wrap, {
      cls: `nox-result-badge nox-badge--${settledState}`,
      kind: resultKind,
      text: labels[settledState],
    });
  }

  private appendProposalBubble(edit: ProposedEdit): void {
    const wrap = this.renderProposal(edit.proposal);
    this.appendProposalActions(wrap, edit);
    this.port.scroll();
  }

  private appendProposalActions(
    wrap: HTMLElement,
    edit: ProposedEdit,
  ): void {
    const proposal = edit.proposal;
    const actions = wrap.createDiv({
      cls: "nox-proposal-actions",
    });

    const rejectBtn = createNoxButton(actions, {
      cls: "nox-btn-reject",
      variant: "secondary",
      text: "Reject",
    });

    const applyBtn = createNoxButton(actions, {
      cls: "nox-btn-apply",
      variant: "primary",
      text: "Apply ✓",
    });

    rejectBtn.addEventListener("click", () => { void (async () => {
      rejectBtn.disabled = true;
      applyBtn.disabled = true;
      try {
        await this.port.reject(edit.id);
        actions.remove();
        createNoxStatus(wrap, {
          cls: "nox-result-badge nox-badge--rejected",
          kind: "neutral",
          text: "✕ Rejected",
        });
        this.port.setState("ANSWER");
      } catch {
        rejectBtn.disabled = false;
        applyBtn.disabled = false;
        this.port.reportError(wrap, "Could not save rejection. Retry.");
      }
    })().catch(error => console.warn("[Nox] UI action failed", error)); });

    applyBtn.addEventListener("click", () => { void (async () => {
      applyBtn.disabled = true;
      rejectBtn.disabled = true;
      applyBtn.textContent = "Applying…";

      try {
        const result = await this.port.apply(edit.id);
        wrap.querySelector(".nox-proposal-retry-status")?.remove();
        if (result.ok) {
          actions.remove();
          if (result.statusSync === "failed") {
            this.appendAppliedStatusRecovery(wrap, edit.id, proposal.file, result.message);
            this.port.setState("ANSWER");
          } else {
            createNoxStatus(wrap, {
              cls: "nox-result-badge nox-badge--applied",
              kind: "success",
              text: "✓ Applied to " + proposal.file,
            });
            this.port.setState("APPLIED");
          }
        } else if (result.reason === "status-unsaved") {
          actions.remove();
          this.appendAppliedStatusRecovery(wrap, edit.id, proposal.file, result.message);
        } else if (result.reason === "no-editor" || result.reason === "error") {
          // Source remains valid: keep Apply available after the user fixes the blocker.
          applyBtn.disabled = false;
          rejectBtn.disabled = false;
          applyBtn.textContent = "Retry Apply";
          createNoxStatus(wrap, {
            cls: "nox-proposal-retry-status",
            kind: "warning",
            text: result.message,
          });
        } else {
          actions.remove();
          createNoxStatus(wrap, {
            cls: "nox-result-badge nox-badge--stale",
            kind: "warning",
            text: result.message,
          });
          this.port.setState("ANSWER");
        }
      } catch {
        applyBtn.disabled = false;
        rejectBtn.disabled = false;
        applyBtn.textContent = "Retry Apply";
        this.port.reportError(wrap, "Could not save the result. Check the note before retrying.");
      }
    })().catch(error => console.warn("[Nox] UI action failed", error)); });
  }

  private appendAppliedStatusRecovery(
    wrap: HTMLElement,
    proposalId: string,
    file: string,
    message?: string,
  ): void {
    const recovery = wrap.createDiv({ cls: "nox-proposal-status-recovery" });
    let status = createNoxStatus(recovery, {
      cls: "nox-proposal-retry-status",
      kind: "warning",
      text: message ?? "Edit applied, but status could not be saved.",
    });
    const retryBtn = createNoxButton(recovery, {
      cls: "nox-btn-sync-status",
      variant: "secondary",
      text: "Retry status sync",
    });
    retryBtn.addEventListener("click", () => { void (async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "Saving status…";
      try {
        const result = await this.port.retryStatus(proposalId);
        if (result.ok && result.statusSync !== "failed") {
          recovery.remove();
          createNoxStatus(wrap, {
            cls: "nox-result-badge nox-badge--applied",
            kind: "success",
            text: "✓ Applied to " + file,
          });
          this.port.setState("APPLIED");
          return;
        }
        status.remove();
        status = createNoxStatus(recovery, {
          cls: "nox-proposal-retry-status",
          kind: "warning",
          text: result.message ?? "Status was not saved. Do not apply the edit again.",
        });
      } catch {
        status.remove();
        status = createNoxStatus(recovery, {
          cls: "nox-proposal-retry-status",
          kind: "warning",
          text: "Status sync failed. The note was already edited; do not apply again.",
        });
      }
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry status sync";
    })().catch(error => console.warn("[Nox] UI action failed", error)); });
  }

  private renderProposal(proposal: EditProposal): HTMLElement {
    const wrap = createNoxSurface(this.thread, "nox-proposal", "approval");
    wrap.createDiv({
      cls: "nox-proposal-badge",
      text: "📄 " + proposal.file,
    });
    if (proposal.reason) {
      wrap.createDiv({ cls: "nox-proposal-reason", text: proposal.reason });
    }
    const diff = wrap.createDiv({ cls: "nox-proposal-diff" });
    proposal.original.split("\n").forEach((line) => {
      diff.createDiv({ cls: "nox-diff-removed", text: "- " + line });
    });
    proposal.replacement.split("\n").forEach((line) => {
      diff.createDiv({ cls: "nox-diff-added", text: "+ " + line });
    });
    return wrap;
  }


}
