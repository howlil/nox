import { summarizeActivity } from "../domain/activity/aggregation";
import type { AgentAdapter, AgentHealth, AgentModel, ApplyResult, ChatSession, ChatMessage } from "../types";
import type { ExplicitContextRef, LearningContext } from "../context/context-types";
import type { SessionPort, ContextPort, PolicyPort, MutationPort, LearningStatePort, RuntimeSettingsWrite, ProgramStorePort, WorkspaceWriterPort } from "./ports";
import type { AgentRuntimePort } from "../agent/AgentRuntime";
import type { LearningEvent, LearningRequest, NoxProgramOverview } from "./learning-types";
import type { PracticeOrigin, PracticeAnswer } from "../domain/practice/types";
import { RunLearningTurn } from "./RunLearningTurn";
import { isActiveLearningScope, isProgramLearningScope, isLockedLearningMode, parseScopeCommand } from "../domain/practice/learning-scope";
import { allowsFocusedTurn } from "../domain/learning-program/focus-transitions";
import { parseProgramCommand } from "../domain/learning-program/commands";
import { feasibility, objectiveProgress } from "../domain/learning-program/rules";
import type { LearningProgramOrchestrator } from "./LearningProgramOrchestrator";

export interface LearningControllerOptions {
  turnTimeoutMs?: number;
  programStore?: ProgramStorePort;
  workspaceWriter?: WorkspaceWriterPort;
  onboardingState?: import("./ports").OnboardingStatePort;
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
  private readonly workspaceWriter?: WorkspaceWriterPort;
  private readonly onboardingState?: import("./ports").OnboardingStatePort;
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
    this.workspaceWriter = options.workspaceWriter;
    this.onboardingState = options.onboardingState;
  }

  checkRuntime(): Promise<AgentHealth> {
    return this.runtime.check();
  }

  getSession(): ChatSession {
    return this.sessions.getSession();
  }

  listSessions(includeArchived = false): ChatSession[] {
    return this.sessions.listSessions(includeArchived);
  }

  async mutateHistory(ids: string[], action: "archive" | "restore" | "delete"): Promise<{
    affected: number;
    activeSessionChanged: boolean;
  }> {
    this.assertRuntimeIdle();
    return this.sessions.mutateHistory(ids, action);
  }

  async selectResponseVersion(messageIndex: number, versionIndex: number): Promise<void> {
    this.assertRuntimeIdle();
    await this.sessions.selectResponseVersion(messageIndex, versionIndex, this.sessions.getSession().id);
  }

  getModels(): AgentModel[] {
    return this.runtime.getModels();
  }

  async getActivitySummary(programId?: string) {
    if (!this.programs) return summarizeActivity([]);
    const all = await this.programs.listPrograms();
    return summarizeActivity(all.programs.filter(program => !programId || program.id === programId));
  }

  async getProgramMenuState(): Promise<{
    activeProgramId?: string;
    sessionActive: boolean;
    programs: Array<{ id: string; goal: string }>;
  }> {
    if (!this.programs) return { sessionActive: false, programs: [] };
    const collection = await this.programs.listPrograms();
    const active = collection.programs.find(item => item.id === collection.activeProgramId);
    return {
      activeProgramId: active?.id,
      sessionActive: Boolean(active?.session || active?.focus?.status === "active"),
      programs: collection.programs.map(item => ({ id: item.id, goal: item.goal })),
    };
  }


  async getOnboardingContext(): Promise<{ hasProgram: boolean; activeNote?: string; dismissed: boolean;
    draft?: import("../domain/onboarding/types").OnboardingDraft }> {
    const programs = await this.getProgramMenuState();
    const context = await this.contexts.resolve();
    const state = await this.onboardingState?.load();
    return { hasProgram: programs.programs.length > 0, activeNote: context.activeNote?.path,
      dismissed: state?.dismissed ?? false, draft: state?.draft };
  }

  async saveOnboardingDraft(draft: import("../domain/onboarding/types").OnboardingDraft): Promise<void> {
    await this.onboardingState?.saveDraft(draft);
  }

  async dismissOnboarding(): Promise<void> {
    await this.onboardingState?.dismiss();
  }

  async reopenOnboarding(): Promise<void> {
    await this.onboardingState?.reopen();
  }

  async discoverLearningDirections(interests: string[], purpose: string) {
    if (!this.programs) throw new Error("Learning programs are unavailable.");
    this.assertRuntimeIdle();
    return this.programs.discoverGoals(interests, purpose);
  }

  async previewLearningProgram(goal: string, constraints: import("../domain/learning-program/types").ProgramConstraints) {
    if (!this.programs) throw new Error("Learning programs are unavailable.");
    this.assertRuntimeIdle();
    return this.programs.prepareProgram(goal, constraints);
  }

  async approveLearningWorkspace(draftId: string, operationId: string) {
    if (!this.programs || !this.workspaceWriter) throw new Error("Learning workspace is unavailable.");
    this.assertRuntimeIdle();
    const program = await this.programs.commitPrepared(draftId, operationId, true);
    await this.workspaceWriter.ensure(program);
    return program;
  }

  async recoverLearningWorkspaces(): Promise<void> {
    if (!this.programs || !this.workspaceWriter) return;
    const programs = await this.programs.listPrograms();
    for (const program of programs.programs) {
      if (program.workspaceApproved) await this.workspaceWriter.ensure(program);
    }
  }

  /** Read-only learning projection; never recompute mastery in the UI. */
  async getProgramOverview(): Promise<NoxProgramOverview | null> {
    if (!this.programs) return null;
    const program = await this.programs.getActiveProgram();
    if (!program) return null;
    const learning = await this.learningState.load();
    const selected = await this.programs.getDecision();
    const next = selected?.decision;
    return {
      goal: program.goal,
      active: Boolean(program.session || program.focus?.status === "active"),
      ...(program.focus ? { focus: { objectiveId: program.focus.objectiveId,
        status: program.focus.status, chatSessionId: program.focus.chatSessionId } } : {}),
      ...(program.session && !program.focus ?
        { sessionTime: (await this.programs.getSessionTime()) ?? undefined } : {}),
      next: { kind: next?.kind ?? "wait", objectiveId: next?.objective?.id,
        reason: next?.reason ?? "No activity is available." },
      objectives: program.objectives.map(objective => {
        const progress = objectiveProgress(program, objective.id, learning.evidence);
        return { objective, status: progress.status, attempts: progress.attempts,
          dueAt: progress.dueAt };
      }),
    };
  }

  async flushSessionTime(): Promise<void> {
    await this.programs?.flushTime();
  }

  getSessionTime(): ReturnType<LearningProgramOrchestrator["getSessionTime"]> {
    return this.programs?.getSessionTime() ?? Promise.resolve(null);
  }

  async setSessionPaused(paused: boolean): Promise<void> {
    if (!this.programs) throw new Error("Learning programs are not configured.");
    if (paused) await this.programs.pauseSession();
    else await this.programs.resumeSession();
  }

  getModelDiscoveryError(): string | undefined {
    return this.runtime.getModelDiscoveryError?.();
  }

  async refreshModels(): Promise<void> {
    await this.runtime.refreshModels?.();
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
    if (this.turns.isRunning() || this.applyingProposals.size > 0 || this.programs?.isPlanning()) {
      throw new Error("Finish the active turn, plan or note edit before changing runtime settings.");
    }
    if (this.appliedButUnsynced.size > 0) throw new Error("Retry saving applied edit status before changing runtime settings.");
  }

  setModel(modelId?: string): Promise<void> {
    this.assertRuntimeIdle();
    return this.sessions.setModel(modelId);
  }

  async newSession(): Promise<ChatSession> {
    if (this.configuringRuntime) throw new Error("Wait for runtime settings to finish saving.");
    if (this.turns.isRunning() || this.applyingProposals.size > 0 || this.programs?.isPlanning()) throw new Error("Finish the active turn or note edit or learning plan before creating a session.");
    if (this.appliedButUnsynced.size > 0) throw new Error("Retry saving applied edit status before changing sessions.");
    return this.sessions.newSession();
  }

  async forkSession(parentId: string, anchorMessageId: string): Promise<{
    session: ChatSession; draftUserPrompt?: string; draftReplyTo?: ChatMessage["replyTo"];
  }> {
    this.assertRuntimeIdle();
    return this.sessions.forkSession(parentId, anchorMessageId);
  }

  async selectSession(id: string): Promise<ChatSession | null> {
    if (this.configuringRuntime) throw new Error("Wait for runtime settings to finish saving.");
    if (this.turns.isRunning() || this.applyingProposals.size > 0 || this.programs?.isPlanning()) throw new Error("Finish the active turn or note edit or learning plan before switching sessions.");
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

  async savePracticeDraft(questionId: string, answer: PracticeAnswer): Promise<void> {
    if (this.turns.isRunning()) return;
    const session = this.sessions.getSession();
    if (!session.messages.some(message => message.parts?.some(part =>
      part.type === "practice-question" && part.questionId === questionId))) {
      throw new Error("This practice question is not in the active session.");
    }
    if (session.messages.some(message => message.parts?.some(part =>
      part.type === "practice-evaluation" && part.questionId === questionId))) return;
    await this.sessions.savePracticeDraft(questionId, answer, session.id);
  }

  /** Every model-backed turn passes through the same session-time accounting boundary. */
  private async *runTimedTurn(request: LearningRequest): AsyncIterable<LearningEvent> {
    const id = request.turnId ?? crypto.randomUUID();
    let timingStarted = false;
    try {
      if (this.programs) {
        try {
          timingStarted = await this.programs.beginAiWait(id);
        } catch (error) {
          // A damaged learning-program file must not make unrelated chat unusable.
          // Program-specific work still fails closed to protect learning evidence.
          if (request.programActivity ||
              (request.action === "practice" && !request.freePractice)) throw error;
          console.warn("[Nox] Learning session timing unavailable; continuing non-program turn.", error);
        }
      }
      for await (const event of this.turns.run(request)) {
        // Release the budget before publishing a terminal event to the view.
        if (timingStarted && (event.type === "completed" || event.type === "failed" ||
            event.type === "cancelled")) {
          // A committed inference result cannot become a retryable failure
          // because an ancillary timer checkpoint failed.
          timingStarted = false;
          try {
            await this.programs!.finishAiWait(id);
          } catch {
            console.warn("[Nox] Learning time checkpoint failed after the turn settled.");
          }
        }
        yield event;
      }
    } catch (error) {
      yield { type: "failed", failure: {
        code: "persistence-failed",
        message: "Nox could not update session time. Learning progress was preserved.",
        diagnostic: error instanceof Error ? error.message : String(error),
      } };
    } finally {
      if (timingStarted) {
        try { await this.programs?.finishAiWait(id); }
        catch { /* Remain safely paused until a successful recovery. */ }
      }
    }
  }

  async *run(request: LearningRequest): AsyncIterable<LearningEvent> {
    if (this.configuringRuntime) {
      yield { type: "failed", failure: { code: "busy", message: "Wait for runtime settings to finish saving." } };
      return;
    }
    // Persisted program focus takes precedence over per-chat scopes and provider actions.
    let focused = false;
    let focusedProgramId: string | undefined;
    let focusedObjectiveId: string | undefined;
    let focusedChatSessionId: string | undefined;
    if (this.programs) {
      try {
        const active = await this.programs.getActiveProgram();
        focused = active?.focus?.status === "active";
        focusedProgramId = active?.focus?.programId;
        focusedObjectiveId = active?.focus?.objectiveId;
        focusedChatSessionId = active?.focus?.chatSessionId;
      } catch (error) {
        // Preserve the pre-existing ordinary-chat availability boundary.
        // Program-specific work must still fail closed when focus cannot be verified.
        const learningIntent = Boolean(request.programActivity) ||
          (request.action === "practice" && !request.freePractice) ||
          /^\/(?:focus|next|start-session|pause-focus|resume-focus|end-focus|plan|use-program)(?:\s|$)/i.test(request.prompt.trim());
        if (learningIntent) {
          yield { type: "failed", failure: { code: "persistence-failed",
            message: "Cannot verify objective focus; restore the program file to continue.",
            diagnostic: error instanceof Error ? error.message : String(error) } };
          return;
        }
        console.warn("[Nox] Learning program focus unavailable; continuing ordinary chat.", error);
      }
    }
    if (focused && (request.regenerate ||
        !allowsFocusedTurn(request.prompt, this.turns.hasActivePracticeQuestion()))) {
      yield { type: "failed", failure: { code: "busy",
        message: "Objective focus locked. Answer the challenge, use /next, or /pause-focus." } };
      return;
    }
    if (focused && focusedChatSessionId &&
        this.sessions.getSession().id !== focusedChatSessionId &&
        !/^\/(?:progress|review-due|programs|session-time|pause-focus|end-focus)(?:\s|$)/i.test(request.prompt.trim())) {
      yield { type: "failed", failure: { code: "busy",
        message: "This focused challenge belongs to chat " + focusedChatSessionId +
          ". Return to that chat, or /pause-focus and /end-focus to switch." } };
      return;
    }
    if (focused && this.turns.hasActivePracticeQuestion() && !request.prompt.trim().startsWith("/")) {
      const question = this.turns.activePracticeIdentity();
      if (!question || question.programId !== focusedProgramId ||
          question.objectiveId !== focusedObjectiveId) {
        yield { type: "failed", failure: { code: "busy",
          message: "This question belongs to another context. Return to the focused question or /pause-focus." } };
        return;
      }
      request = { ...request, action: "practice" };
    }
    if (request.prompt.trim().toLowerCase() === "/hint") {
      if (this.turns.isRunning() || this.applyingProposals.size > 0) {
        yield { type: "failed", failure: { code: "busy", message: "Finish the active operation before requesting a hint." } };
        return;
      }
      if (!this.turns.hasActivePracticeQuestion()) {
        yield { type: "response-delta", text: "No active question to hint." };
        yield { type: "completed" }; return;
      }
      const hint = this.turns.peekPracticeHint();
      if (!hint) {
        yield { type: "response-delta", text: "No hint is available for this question." };
        yield { type: "completed" }; return;
      }
      // A failed write must not publish an assisted attempt or half a hint.
      const sessionId = this.sessions.getSession().id;
      try {
        await this.sessions.recordPracticeHint(hint, sessionId, request.turnId);
        this.turns.getPracticeHint();
      } catch (error) {
        yield { type: "failed", failure: { code: "persistence-failed",
          message: "Could not save the hint. Retry after checking storage.",
          diagnostic: error instanceof Error ? error.message : String(error) } };
        return;
      }
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
      const currentScope = this.sessions.getSession().learningScope;
      if (isProgramLearningScope(currentScope) && currentScope.mode !== "FREE" &&
          (command.kind === "plan" || command.kind === "use-program")) {
        yield { type: "failed", failure: { code: "busy",
          message: "Pause the current learning mode before switching or creating a program." } };
        return;
      }
      if (!isProgramLearningScope(currentScope) && isLockedLearningMode(currentScope?.mode) &&
          (command.kind === "next" || command.kind === "plan")) {
        yield { type: "failed", failure: { code: "busy",
          message: "Use /pause to leave the legacy backend-only learning lock before starting a general program." } };
        return;
      }
      try {
        let response = "";
        if (command.kind === "plan") {
          if (this.turns.hasActivePracticeQuestion()) {
            throw new Error("Finish or exit the active Practice question before replacing the learning plan.");
          }
          const program = await this.programs.createProgram(command.goal, command.constraints, request.turnId);
          const f = feasibility(program);
          response = [
            `Created learning program: **${program.goal}**`,
            `**Curriculum:** ${program.objectives.length} measurable objectives`,
            ...program.objectives.map((objective, index) =>
              `${index + 1}. **${objective.title}** — ${objective.outcome} (${objective.estimatedMinutes} min)`),
            `**Time:** ${program.constraints.minutesPerSession} min/session, ${program.constraints.sessionsPerWeek} sessions/week`,
            f.feasible === false ? `**Schedule at risk:** ~${f.estimatedMinutes} min required, ~${f.availableMinutes} min available. Reduce scope, change the deadline, or increase your time budget.` :
              `**Estimated work including review:** ${f.estimatedMinutes} min.`,
            "Use /progress for objective IDs, then /focus <objective-id> and /next for self-paced learning.",
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
        } else if (command.kind === "replan") {
          if (this.turns.hasActivePracticeQuestion()) {
            throw new Error("Finish the current challenge before revising the curriculum.");
          }
          const revised = await this.programs.replanFromEvidence();
          const revision = revised?.curriculumRevisions?.at(-1);
          response = revision
            ? "Curriculum version " + revision.toVersion +
              ": added prerequisite " + revision.addedObjectiveId +
              " from evidence " + revision.reasonEvidenceIds.join(", ") +
              ". Use /progress to inspect the revised objectives."
            : "No repeated criterion gap requires structural curriculum revision yet.";
        } else if (command.kind === "focus") {
          if (this.turns.hasActivePracticeQuestion()) {
            throw new Error("Finish the existing practice question before starting objective focus.");
          }
          const program = await this.programs.startFocus(command.objectiveId, this.sessions.getSession().id);
          const objective = program.objectives.find(item => item.id === command.objectiveId)!;
          response = "Focused: **" + objective.title +
            "**. Use /next, /pause-focus, or /end-focus.";
        } else if (command.kind === "pause-focus") {
          await this.programs.pauseFocus();
          response = "Objective focus paused. Use /resume-focus when ready.";
        } else if (command.kind === "resume-focus") {
          const program = await this.programs.resumeFocus();
          response = "Resumed objective: " +
            program.objectives.find(item => item.id === program.focus?.objectiveId)?.title;
        } else if (command.kind === "end-focus") {
          await this.programs.endFocus();
          response = "Objective focus ended; learning evidence remains saved.";
        } else if (command.kind === "free-practice") {
          if (this.turns.hasActivePracticeQuestion()) throw new Error("Finish the active question before starting free practice.");
          yield* this.runTimedTurn({ ...request, action: "practice", freePractice: true,
            prompt: "Ask me an independent practice question based on the current context." });
          return;
        } else if (command.kind === "progress") {
          response = await this.programs.progressSummary();
        } else if (command.kind === "review-due") {
          response = await this.programs.reviewDueSummary();
        } else if (command.kind === "start-session") {
          const program = await this.programs.startSession();
          response = `Learning session started. Timebox: ${program.constraints.minutesPerSession} min. Use /next to begin.`;
        } else if (command.kind === "pause-session") {
          await this.programs.pauseSession();
          response = "Learning session paused. Use /resume-session when ready.";
        } else if (command.kind === "resume-session") {
          await this.programs.resumeSession();
          response = "Learning session resumed. AI waiting time does not consume study budget.";
        } else if (command.kind === "session-time") {
          const time = await this.programs.getSessionTime();
          response = time
            ? [`Learning session: ${time.status}.`,
                `Confirmed active: ${Math.round(time.activeMs / 1000)}s.`,
                `Waiting for AI: ${Math.round(time.aiWaitingMs / 1000)}s.`,
                `Remaining: ${Math.ceil(time.remainingMs / 60_000)} / ${time.budgetMs / 60_000} minutes.`].join("\n")
            : "No active learning session. Use /start-session.";
        } else if (command.kind === "end-session") {
          await this.programs.endSession();
          response = "Session ended. Program progress remains saved. Use /start-session when ready.";
        } else if (command.kind === "extend-session") {
          const program = await this.programs.extendSession(command.minutes);
          response = "Session timebox extended to " + program.session!.timeBudgetMinutes + " minutes.";
        } else {
          if (this.turns.hasActivePracticeQuestion()) {
            response = "Answer the active question first, or use /hint for a small nudge.";
          } else {
            const selected = await this.programs.getDecision();
            if ((selected?.program?.session || selected?.program?.focus?.status === "active") && selected.decision.objective) {
              await this.programs.focusObjective(selected.decision.objective.id);
              if (selected.program.workspaceApproved) {
                try {
                  await this.workspaceWriter?.ensureObjective?.(
                    selected.program, selected.decision.objective.id);
                } catch (error) {
                  // Materialization is ancillary; a filesystem conflict must not lose learning progress.
                  console.warn("[Nox] Lesson outline could not be materialized", error);
                }
              }
            }
            if (selected?.program && !selected.program.session && selected.program.focus?.status !== "active") {
              response = "Use /focus <objective-id> for self-paced study or /start-session for legacy timed study.";
            } else if (selected?.decision.kind === "wait" ||
                selected?.decision.kind === "timebox-ended") {
              response = selected.decision.reason;
            } else if (selected?.decision.kind === "teach" && selected.decision.objective) {
              const objective = selected.decision.objective;
              const state = await this.learningState.load();
              const last = state.evidence.filter(item =>
                item.programId === selected.program.id && item.objectiveId === objective.id &&
                item.scope === "learner" && item.type === "practice").at(-1);
              const activity = this.runTimedTurn({
                ...request, action: "explain",
                programActivity: { kind: "teach", programId: selected.program.id, objectiveId: objective.id },
                prompt: "Teach the objective after my difficulty: " + objective.outcome,
              });
              for await (const event of activity) {
                if (event.type === "completed" && last) {
                  await this.programs.markTaught(objective.id, last.createdAt);
                }
                yield event;
              }
              return;
            } else if (selected?.decision.objective) {
              yield* this.runTimedTurn({ ...request, action: "practice" });
              return;
            }
            if (!selected?.program || selected.program.session || selected.program.focus) {
              response = selected?.decision.reason ?? "No active program. Use /plan <goal> first.";
            }
          }
        }
        if (!request.retry) await this.sessions.recordUserMessage(request.prompt, this.sessions.getSession().id, "ask", request.turnId);
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
    yield* this.runTimedTurn(request);
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
    if (isActiveLearningScope(this.sessions.getSession().learningScope)) {
      return { ok: false, reason: "unauthorized",
        message: "Learning mode is locked. Type /pause before applying a note edit." };
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
    this.programs?.dispose();
  }
}
