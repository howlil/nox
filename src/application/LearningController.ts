import type { AgentAdapter, AgentHealth, AgentModel, ApplyResult, ChatSession } from "../types";
import type { ExplicitContextRef, LearningContext } from "../context/context-types";
import type { SessionPort, ContextPort, PolicyPort, MutationPort, LearningStatePort, RuntimeSettingsWrite, ProgramStorePort } from "./ports";
import type { AgentRuntimePort } from "../agent/AgentRuntime";
import type { LearningEvent, LearningRequest } from "./learning-types";
import type { PracticeOrigin } from "../domain/practice/types";
import { RunLearningTurn } from "./RunLearningTurn";
import { isLockedLearningMode, parseScopeCommand } from "../domain/practice/learning-scope";
import { parseProgramCommand } from "../domain/learning-program/commands";
import { feasibility } from "../domain/learning-program/rules";
import type { LearningProgramOrchestrator } from "./LearningProgramOrchestrator";

export interface LearningControllerOptions {
  turnTimeoutMs?: number;
  programStore?: ProgramStorePort;
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
    private readonly programs?: LearningProgramOrchestrator,
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
    if (request.prompt.trim().toLowerCase() === "/hint") {
      if (!this.turns.hasActivePracticeQuestion()) {
        yield { type: "response-delta", text: "No active question to hint." };
        yield { type: "completed" }; return;
      }
      const hint = this.turns.getPracticeHint();
      if (!hint) {
        yield { type: "response-delta", text: "No hint is available for this question." };
        yield { type: "completed" }; return;
      }
      await this.sessions.recordUserMessage("/hint", this.sessions.getSession().id, "practice");
      await this.sessions.recordAssistantMessage("Hint: " + hint, undefined, this.sessions.getSession().id);
      yield { type: "response-delta", text: "Hint: " + hint };
      yield { type: "completed" }; return;
    }
    let command: ReturnType<typeof parseProgramCommand>;
    try { command = parseProgramCommand(request.prompt); }
    catch (error) {
      yield { type: "failed", failure: { code: "unknown",
        message: error instanceof Error ? error.message : "Invalid plan command." } };
      return;
    }
    if (command) {
      if (!this.programs) {
        yield { type: "failed", failure: { code: "unknown", message: "Learning programs are not configured." } };
        return;
      }
      if (this.turns.isRunning() || this.applyingProposals.size > 0 || this.programs.isPlanning()) {
        yield { type: "failed", failure: { code: "busy", message: "Finish the active operation first." } };
        return;
      }
      if (isLockedLearningMode(this.sessions.getSession().learningScope?.mode) &&
          (command.kind === "next" || command.kind === "plan")) {
        yield { type: "failed", failure: { code: "busy",
          message: "Use /pause to leave the legacy backend-only learning lock before starting a general program." } };
        return;
      }
      try {
        let response: string;
        if (command.kind === "plan") {
          const program = await this.programs.createProgram(command.goal, command.constraints);
          const f = feasibility(program);
          response = [
            `Created learning program: **${program.goal}**`,
            `**Curriculum:** ${program.objectives.length} measurable objectives`,
            ...program.objectives.map((objective, index) =>
              `${index + 1}. **${objective.title}** — ${objective.outcome} (${objective.estimatedMinutes} min)`),
            `**Time:** ${program.constraints.minutesPerSession} min/session, ${program.constraints.sessionsPerWeek} sessions/week`,
            f.feasible === false ? `**Schedule at risk:** ~${f.estimatedMinutes} min required, ~${f.availableMinutes} min available. Reduce scope, change the deadline, or increase your time budget.` :
              `**Estimated work including review:** ${f.estimatedMinutes} min.`,
            "Use /start-session, then /next. Use /progress to inspect your plan.",
          ].join("\n\n");
        } else if (command.kind === "programs") {
          const collection = await this.programs.listPrograms();
          response = collection.programs.length
            ? collection.programs.map(p =>
                `${p.id === collection.activeProgramId ? "**Active** " : ""}${p.goal} (ID: ${p.id})`).join("\n\n")
            : "No saved learning programs yet. Use /plan <goal>.";
        } else if (command.kind === "use-program") {
          if (this.turns.hasActivePracticeQuestion()) {
            throw new Error("Finish the current practice question before switching programs.");
          }
          const selected = await this.programs.selectProgram(command.id);
          response = `Active program changed to: ${selected.goal}`;
        } else if (command.kind === "progress" || command.kind === "review-due") {
          response = await this.programs.progressSummary();
        } else if (command.kind === "start-session") {
          const program = await this.programs.startSession();
          response = `Learning session started. Timebox: ${program.constraints.minutesPerSession} min. Use /next to begin.`;
        } else if (command.kind === "end-session") {
          await this.programs.endSession();
          response = "Session ended. Program progress remains saved. Use /start-session when ready.";
        } else {
          if (this.turns.hasActivePracticeQuestion()) {
            response = "Answer the active question first, or use /hint for a small nudge.";
          } else {
            const selected = await this.programs.getDecision();
            if (selected?.program && !selected.program.session) {
              response = "Start a timeboxed session first with /start-session.";
            } else if (selected?.decision.objective) {
              yield* this.turns.run({ ...request, action: "practice" });
              return;
            }
            response = selected?.decision.reason ?? "No active program. Use /plan <goal> first.";
          }
        }
        if (!request.retry) await this.sessions.recordUserMessage(request.prompt, this.sessions.getSession().id, "ask");
        await this.sessions.recordAssistantMessage(response, undefined, this.sessions.getSession().id);
        yield { type: "response-delta", text: response };
        yield { type: "completed" }; return;
      } catch (error) {
        yield { type: "failed", failure: { code: "unknown",
          message: error instanceof Error ? error.message : "Unable to finish program operation." } };
        return;
      }
    }
    if (parseScopeCommand(request.prompt) && this.applyingProposals.size > 0) {
      yield { type: "failed", failure: { code: "busy",
        message: "Wait for the note edit to finish before changing learning mode." } };
      return;
    }
    if (this.programs?.isPlanning()) {
      yield { type: "failed", failure: { code: "busy", message: "Curriculum generation is in progress." } };
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
    this.programs?.cancel();
  }

  dispose(): void {
    this.turns.dispose();
  }
}
