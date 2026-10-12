import type { AgentHealth, AgentModel, ApplyResult, ChatSession } from "../types";
import type { ContextResolver } from "../context/ContextResolver";
import type { ExplicitContextRef, LearningContext } from "../context/context-types";
import type { PolicyLoader } from "../context/PolicyLoader";
import type { MutationService } from "../mutation/MutationService";
import type { VaultLearningStore } from "../persistence/VaultLearningStore";
import type { SessionController } from "../session/SessionController";
import type { AgentRuntimePort } from "../agent/AgentRuntime";
import type { LearningEvent, LearningRequest } from "./learning-types";
import type { PracticeOrigin } from "../domain/practice/types";
import { RunLearningTurn } from "./RunLearningTurn";

type SessionPort = Pick<
  SessionController,
  | "getSession"
  | "listSessions"
  | "selectSession"
  | "setModel"
  | "newSession"
  | "recordUserMessage"
  | "setConversationId"
  | "recordAssistantMessage"
  | "recordStructuredPart"
  | "recordPracticeOutcome"
  | "recordReviewOutcome"
  | "recordProposal"
  | "getProposal"
  | "updateProposalState"
>;

type ContextPort = Pick<
  ContextResolver,
  "resolve" | "searchNotes" | "toAgentContext"
>;

type PolicyPort = Pick<PolicyLoader, "load">;
type MutationPort = Pick<MutationService, "apply">;
type LearningStatePort = Pick<VaultLearningStore, "load" | "save">;

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

  setModel(modelId?: string): Promise<void> {
    return this.sessions.setModel(modelId);
  }

  async newSession(): Promise<ChatSession> {
    if (this.turns.isRunning()) throw new Error("Finish or stop the active turn before creating a session.");
    return this.sessions.newSession();
  }

  async selectSession(id: string): Promise<ChatSession | null> {
    if (this.turns.isRunning()) throw new Error("Finish or stop the active turn before switching sessions.");
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
    yield* this.turns.run(request);
  }

  async applyProposal(
    proposalId: string,
  ): Promise<ApplyResult> {
    const record = this.sessions.getProposal(proposalId);

    if (this.applyingProposals.has(proposalId) || !record || record.state !== "pending") {
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
        await this.sessions.updateProposalState(proposalId, "applied");
      } else if (
        result.reason === "stale" ||
        result.reason === "ambiguous" ||
        result.reason === "unauthorized" ||
        result.reason === "missing-file"
      ) {
        await this.sessions.updateProposalState(proposalId, "stale");
      }

      return result;
    } finally {
      this.applyingProposals.delete(proposalId);
    }
  }

  async rejectProposal(
    proposalId: string,
  ): Promise<void> {
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
