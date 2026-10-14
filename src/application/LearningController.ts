import type { AgentAdapter, AgentHealth, AgentModel, ApplyResult, ChatSession } from "../types";
import type { ExplicitContextRef, LearningContext } from "../context/context-types";
import type { SessionPort, ContextPort, PolicyPort, MutationPort, LearningStatePort, RuntimeSettingsWrite } from "./ports";
import type { AgentRuntimePort } from "../agent/AgentRuntime";
import type { LearningEvent, LearningRequest } from "./learning-types";
import type { PracticeOrigin } from "../domain/practice/types";
import { RunLearningTurn } from "./RunLearningTurn";
import { isLockedLearningMode, parseScopeCommand } from "../domain/practice/learning-scope";

export interface LearningControllerOptions {
  turnTimeoutMs?: number;
}

/**
 * Application boundary for the Learning OS.
 *
 * The view sends user intent here. This controller owns orchestration:
 * context -> policy -> learning state -> action -> agent session -> normalized
 * UI events. Provider transport stays behind the AgentRuntime boundary.
 */

/**
 * Stable UI-facing facade. Runtime turn orchestration lives in RunLearningTurn.
 * Approval and proposal lifecycle are owned here until a concrete split is needed.
 */
export class LearningController {
  private readonly turns: RunLearningTurn;
  private readonly applyingProposals = new Set<string>();
  private configuringRuntime = false;
  // Short-lived receipt: editor mutation succeeded, but the durable applied
  // status has not been confirmed. Never use this as a session state authority.
  private readonly appliedButUnsynced = new Map<string, string>();

  private readonly statusSyncFailure = {
    ok: true as const,
    statusSync: "failed" as const,
    message: "Edit was applied to the note, but its status was not saved. Retry status sync; do not apply the edit again.",
  };

  constructor(
    private readonly sessions: SessionPort,
    private readonly runtime: AgentRuntimePort,
    private readonly contexts: ContextPort,
    private readonly policies: PolicyPort,
    private readonly mutations: MutationPort,
    private readonly learningState: LearningStatePort,
    options: LearningControllerOptions = {},
  ) {
    this.turns = new RunLearningTurn(sessions, runtime, contexts, policies, learningState, options);
  }

  checkRuntime(): Promise<AgentHealth> {
    return this.runtime.check();
  }

  getSession(): ChatSession {
    return this.sessions.getSession();
  }

  listSessions(): ChatSession[] {
    return this.sessions.listSessions();
  }

  getModels(): AgentModel[] {
    return this.runtime.getModels();
  }

  async configureRuntime(
    provider: string, adapter: AgentAdapter | undefined, preferredModel?: string,
    options: RuntimeSettingsWrite = {},
  ): Promise<void> {
    this.assertRuntimeIdle();
    if (adapter && !this.runtime.replaceAdapter) throw new Error("Runtime does not support provider changes.");
    this.configuringRuntime = true;
    try {
      await this.sessions.configureRuntime(provider, preferredModel, options);
      if (adapter) await this.runtime.replaceAdapter!(adapter);
    } finally {
      this.configuringRuntime = false;
    }
  }

  private assertRuntimeIdle(): void {
    if (this.configuringRuntime) throw new Error("Wait for runtime settings to finish saving.");
    if (this.turns.isRunning() || this.applyingProposals.size > 0) {
      throw new Error("Finish or stop the active turn or note edit before changing runtime settings.");
    }
    if (this.appliedButUnsynced.size > 0) throw new Error("Retry saving applied edit status before changing runtime settings.");
  }

  setModel(modelId?: string): Promise<void> {
    if (this.configuringRuntime) throw new Error("Wait for runtime settings to finish saving.");
    return this.sessions.setModel(modelId);
  }

  async newSession(): Promise<ChatSession> {
    if (this.configuringRuntime) throw new Error("Wait for runtime settings to finish saving.");
    if (this.turns.isRunning() || this.applyingProposals.size > 0) throw new Error("Finish the active turn or note edit before creating a session.");
    if (this.appliedButUnsynced.size > 0) throw new Error("Retry saving applied edit status before changing sessions.");
    return this.sessions.newSession();
  }

  async selectSession(id: string): Promise<ChatSession | null> {
    if (this.configuringRuntime) throw new Error("Wait for runtime settings to finish saving.");
    if (this.turns.isRunning() || this.applyingProposals.size > 0) throw new Error("Finish the active turn or note edit before switching sessions.");
    if (this.appliedButUnsynced.size > 0) throw new Error("Retry saving applied edit status before changing sessions.");
    return this.sessions.selectSession(id);
  }


  hasActivePracticeQuestion(): boolean {
    return this.turns.hasActivePracticeQuestion();
  }

  getActivePracticeOrigin(): PracticeOrigin | undefined {
    return this.turns.getActivePracticeOrigin();
  }

  resolveContext(explicitContext: ExplicitContextRef[] = []): Promise<LearningContext> {
    return this.turns.resolveContext(explicitContext);
  }

  searchNotes(query: string, limit = 8): Array<{ path: string; name: string }> {
    return this.turns.searchNotes(query, limit);
  }

  async *run(request: LearningRequest): AsyncIterable<LearningEvent> {
    if (this.configuringRuntime) {
      yield { type: "failed", failure: { code: "busy", message: "Wait for runtime settings to finish saving." } };
      return;
    }
    if (parseScopeCommand(request.prompt) && this.applyingProposals.size > 0) {
      yield { type: "failed", failure: { code: "busy",
        message: "Wait for the note edit to finish before changing learning mode." } };
      return;
    }
    yield* this.turns.run(request);
  }

  async applyProposal(
    proposalId: string,
  ): Promise<ApplyResult> {
    if (this.configuringRuntime) return { ok: false, reason: "error", message: "Wait for runtime settings to finish saving." };
    if (this.appliedButUnsynced.has(proposalId)) {
      return {
        ok: false,
        reason: "status-unsaved",
        message: this.statusSyncFailure.message,
      };
    }
    if (isLockedLearningMode(this.sessions.getSession().learningScope?.mode)) {
      return { ok: false, reason: "unauthorized",
        message: "Backend learning is locked. Type /pause before applying a note edit." };
    }
    if (this.turns.isRunning()) {
      return { ok: false, reason: "error",
        message: "Finish or stop the active turn before applying a note edit." };
    }
    const originSessionId = this.sessions.getSession().id;
    const record = this.sessions.getProposal(proposalId);

    if (this.applyingProposals.size > 0 || !record || record.state !== "pending") {
      return {
        ok: false,
        reason: "stale",
        message:
          "This proposal is no longer active. Regenerate the edit.",
      };
    }

    this.applyingProposals.add(proposalId);
    try {
      const result = await this.mutations.apply(
        record.proposal,
        record.mutableFile,
      );

      if (result.ok) {
        this.appliedButUnsynced.set(proposalId, originSessionId);
        try {
          await this.sessions.updateProposalState(proposalId, "applied", originSessionId);
          this.appliedButUnsynced.delete(proposalId);
        } catch {
          // Do not report a failed editor mutation: the note already changed.
          // Keep the local receipt to prevent invoking replaceRange again.
          return { ...this.statusSyncFailure };
        }
      } else if (
        result.reason === "stale" ||
        result.reason === "ambiguous" ||
        result.reason === "unauthorized" ||
        result.reason === "missing-file"
      ) {
        await this.sessions.updateProposalState(proposalId, "stale", originSessionId);
      }

      return result;
    } finally {
      this.applyingProposals.delete(proposalId);
    }
  }

  /**
   * Recover a successful editor mutation by persisting its status only.
   * Never call MutationService.apply again for this proposal.
   */
  async retryAppliedStatus(proposalId: string): Promise<ApplyResult> {
    const originSessionId = this.appliedButUnsynced.get(proposalId);
    if (!originSessionId) {
      return {
        ok: false, reason: "stale",
        message: "No unapplied status sync is pending for this proposal.",
      };
    }
    if (this.applyingProposals.size > 0) {
      return {
        ok: false, reason: "status-unsaved",
        message: "Status sync is already in progress.",
      };
    }

    this.applyingProposals.add(proposalId);
    try {
      await this.sessions.updateProposalState(proposalId, "applied", originSessionId);
      this.appliedButUnsynced.delete(proposalId);
      return { ok: true };
    } catch {
      return { ...this.statusSyncFailure };
    } finally {
      this.applyingProposals.delete(proposalId);
    }
  }

  async rejectProposal(
    proposalId: string,
  ): Promise<void> {
    if (this.appliedButUnsynced.has(proposalId)) {
      throw new Error("Edit is already applied. Retry saving its status instead.");
    }
    if (this.applyingProposals.size > 0) {
      throw new Error("Finish the active note edit before rejecting a proposal.");
    }
    const record = this.sessions.getProposal(proposalId);
    if (!record || record.state !== "pending") return;

    await this.sessions.updateProposalState(
      proposalId,
      "rejected",
    );
  }


  cancel(): void {
    this.turns.cancel();
  }

  dispose(): void {
    this.turns.dispose();
  }
}
