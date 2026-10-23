import {
  AgentContext,
  type ResearchScope,
  AgentFailure,
  ChatSession,
} from "../types";
import {
  ExplicitContextRef,
  LearningContext,
  TurnContextSnapshot,
} from "../context/context-types";
import type { SessionPort, ContextPort, PolicyPort, LearningStatePort, ProgramStorePort } from "./ports";
import { formatReplyPrompt } from "./reply-context";
import { PersistenceError } from "../domain/persistence/errors";
import { TranscriptEvidenceReconciler } from "../features/conversation/turn/TranscriptEvidenceReconciler";
import { StructuredTurnBuffer } from "../features/conversation/turn/StructuredTurnBuffer";
import { InvalidLearningOutputError } from "../features/conversation/turn/turn-output-error";
import { buildLearningContextPackage } from "./LearningContextOrchestrator";
import { prepareTurnInvocation } from "../features/conversation/turn/TurnProviderEnvelope";
import type { ResearchResult } from "../context/LocalResearch";
import { constrainResearchContext, parseResearchRequest, resolveResearchScope } from "./research-scope";
import {
  recordPracticeEvaluation,
  recordReviewFindings,
} from "../domain/learning-state/transitions";
import { findCommittedPracticeOutcome, findCommittedReview, type TranscriptPart } from "../session/transcript-types";
import type { AgentRuntimePort } from "../types";
import {
  buildActionInstruction,
  selectGraphPresentation,
  buildPracticeEvaluationInstruction,
  buildPracticeQuestionInstruction,
  buildScopedPracticeInstruction,
  buildProgramScopedPracticeInstruction,
} from "./action-builders";
import { isLockedLearningMode, isProgramLearningScope, parseScopeCommand, scopeDeflection, transitionLearningScope, transitionProgramLearningScope } from "../domain/practice/learning-scope";
import { toPromptLearningState } from "./learning-state-projection";
import {
  LearningEvent,
  LearningRequest,
} from "./learning-types";
import { PracticeQuestion, PracticeOrigin, PracticeEvaluation } from "../domain/practice/types";
import { validatePracticeAnswer, gradeMultipleChoice } from "../domain/practice/question-schema";
import {
  PracticeEvaluationAttempt,
  PracticeStateMachine,
} from "../domain/practice/PracticeStateMachine";
import { PracticeSessionRegistry } from "./PracticeSessionRegistry";
import type { LearningProgram, LearningObjective } from "../domain/learning-program/types";
import { selectAdaptiveActivity } from "../domain/learner-model/activity-policy";
import { coversCriteria } from "../domain/learning-program/assessment-rubric";
import { criterionIdFor, decideFeedback } from "../domain/learner-model/feedback-policy";
import {
  type StructuredStreamEvent,
  StructuredStreamParser,
} from "../agent/StructuredStreamParser";

/**
 * Application boundary for the Learning OS.
 *
 * The view sends user intent here. This controller owns orchestration:
 * context -> policy -> learning state -> action -> agent session -> normalized
 * UI events. Provider transport stays behind the AgentRuntime boundary.
 */
/**
 * Application use case: one learning turn and its session-scoped practice state.
 * This is the sole owner of the active-turn lock, timeout, and normalized stream.
 */
export class RunLearningTurn {
  private readonly practices = new PracticeSessionRegistry();
  private readonly evidence: TranscriptEvidenceReconciler;
  private currentFocusId: string | null = null;
  private currentFocusPaused = false;

  /** Old focus challenges must never be inherited by a replacement focus. */
  syncFocusSessionId(id?: string, status?: "active" | "paused"): void {
    const next = id ?? null;
    if (next !== this.currentFocusId) {
      this.practices.clear();
      this.currentFocusId = next;
    }
    this.currentFocusPaused = Boolean(next && status === "paused");
  }

  private async assertFocusAuthority(expected: NonNullable<LearningProgram["focus"]>, chatSessionId: string): Promise<void> {
    if (!this.programStore) throw new Error("Focus persistence is unavailable.");
    const collection = await this.programStore.load();
    const current = collection.programs.find(p => p.id === expected.programId);
    if (collection.activeProgramId !== expected.programId || current?.focus?.id !== expected.id ||
        current.focus.status !== "active" || current.focus.chatSessionId !== chatSessionId ||
        current.focus.objectiveId !== expected.objectiveId ||
        current.focus.curriculumRevision !== expected.curriculumRevision ||
        current.planVersion !== expected.curriculumRevision) {
      throw new Error("The focused objective changed during inference; discard stale model output.");
    }
  }
  private activeTurn: {
    controller: AbortController;
    cancelReason?: "user" | "timeout" | "dispose";
  } | null = null;
  private readonly turnTimeoutMs: number;
  private readonly programStore?: ProgramStorePort;

  constructor(
    private readonly sessions: SessionPort,
    private readonly runtime: AgentRuntimePort,
    private readonly contexts: ContextPort,
    private readonly policies: PolicyPort,
    private readonly learningState: LearningStatePort,
    options: { turnTimeoutMs?: number; programStore?: ProgramStorePort } = {},
  ) {
    // Hard turn deadline: long reasoning/streaming must not fail at the former 60s cutoff.
    this.turnTimeoutMs = options.turnTimeoutMs ?? 300_000;
    this.programStore = options.programStore;
    this.evidence = new TranscriptEvidenceReconciler(learningState);
  }

  isRunning(): boolean {
    return this.activeTurn !== null;
  }

  hasActivePracticeQuestion(): boolean {
    return this.practiceForSession(this.sessions.getSession()).isWaitingForAnswer();
  }

  peekPracticeHint(): string | undefined {
    return this.practiceForSession(this.sessions.getSession()).peekHint();
  }

  getPracticeHint(): string | undefined {
    return this.practiceForSession(this.sessions.getSession()).markHintUsed();
  }

  getActivePracticeOrigin(): PracticeOrigin | undefined {
    const practice = this.practiceForSession(this.sessions.getSession());
    return practice.isWaitingForAnswer() ? practice.snapshot()?.origin : undefined;
  }

  /** Reconstruct the active question from the same durable conversation transcript. */
  private practiceForSession(session: ChatSession): PracticeStateMachine {
    const legacy = !isProgramLearningScope(session.learningScope) &&
      isLockedLearningMode(session.learningScope?.mode);
    const programId = isProgramLearningScope(session.learningScope) &&
      session.learningScope.mode !== "FREE" ? session.learningScope.programId : undefined;
    // A paused objective can contain unrelated chat messages; preserve the
    // committed pending challenge across those messages until focus ends.
    const scoped = legacy || Boolean(programId) || Boolean(this.currentFocusId);
    const key = legacy ? `${session.id}:backend`
      : programId ? JSON.stringify([session.id, "program", programId]) : session.id;
    const practice = this.practices.forSession(key);
    if (practice.snapshot()) return practice;
    const inheritedCount = session.fork?.inheritedMessageCount ?? 0;
    for (let i = session.messages.length - 1; i >= inheritedCount; i--) {
      const message = session.messages[i];
      // Only whitelisted informational commands preserve an unanswered question.
      // Ordinary Ask/Explain and explicit mode changes end free-Practice recovery.
      if (!scoped && message.role === "user" && message.action && message.action !== "practice" &&
          !["/progress", "/review-due", "/programs", "/extend-session"].some(command =>
            message.content.trim().toLowerCase().startsWith(command))) break;
      const parts = message.parts ?? [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j];
        if (part.type === "review-findings") continue;
        if (legacy ? part.scope !== "backend" : programId
          ? part.scope !== "program" ||
            (part.type === "practice-question" ? part.question.programId : part.evaluation.programId) !== programId
          : part.scope === "backend" || part.scope === "program") continue;
        if (part.type === "practice-evaluation" && (this.currentFocusId
          ? part.evaluation.focusSessionId !== this.currentFocusId
          : Boolean(part.evaluation.focusSessionId))) continue;
        if (part.type === "practice-evaluation") return practice;
        if (part.type === "practice-question" && (this.currentFocusId
          ? part.question.focusSessionId !== this.currentFocusId
          : Boolean(part.question.focusSessionId))) continue;
        if (part.type === "practice-question") {
          practice.start(part.origin);
          practice.acceptQuestion(part.question, part.questionId);
          if (session.messages.slice(i + 1).some(item => item.role === "user" &&
              item.content.trim().toLowerCase().startsWith("/clarify "))) {
            practice.markClarificationUsed();
          } else if (session.messages.slice(i + 1).some(item => item.role === "user" &&
              item.content.trim().toLowerCase() === "/hint")) practice.markHintUsed();
          return practice;
        }
      }
    }
    return practice;
  }

  async resolveContext(
    explicitContext: ExplicitContextRef[] = [],
  ): Promise<LearningContext> {
    return this.contexts.resolve(explicitContext);
  }

  searchNotes(
    query: string,
    limit = 8,
  ): Array<{ path: string; name: string }> {
    return this.contexts.searchNotes(query, limit);
  }

  async *run(
    request: LearningRequest,
  ): AsyncIterable<LearningEvent> {
    if (this.activeTurn) {
      yield {
        type: "failed",
        failure: {
          code: "busy",
          message: "Another Nox turn is still running.",
        },
      };
      return;
    }

    // Capture the complete user-visible turn, including context and preflight work.
    const runStartedAt = performance.now();
    // Lock before asynchronous context/policy preparation.
    const controller = new AbortController();
    const activeTurn = { controller } as {
      controller: AbortController;
      cancelReason?: "user" | "timeout" | "dispose";
    };
    this.activeTurn = activeTurn;

    const sessionAtStart = this.sessions.getSession();
    // Regenerate is NOT retry: validate the latest plain Ask/Explain pair
    // before I/O and never append a duplicate user transcript message.
    if (request.regenerate) {
      const index = request.regenerate.messageIndex;
      const message = sessionAtStart.messages[index];
      const user = sessionAtStart.messages[index - 1];
      const valid = Number.isInteger(index) && index === sessionAtStart.messages.length - 1 &&
        message?.role === "assistant" &&
        message.content === request.regenerate.expectedContent &&
        !message.proposal && !message.parts?.length &&
        user?.role === "user" && user.content === request.prompt &&
        user.action === request.action &&
        (request.action === "ask" || request.action === "explain") &&
        !this.practiceForSession(sessionAtStart).isWaitingForAnswer();
      if (!valid) {
        this.activeTurn = null;
        yield { type: "failed", failure: {
          code: "unknown", message: "This answer can no longer be regenerated safely.",
        } };
        return;
      }
    }
    const scopeCommand = parseScopeCommand(request.prompt);
    if (scopeCommand) {
      try {
        const oldScope = sessionAtStart.learningScope;
        const existingProgramScope = isProgramLearningScope(oldScope) ? oldScope : undefined;
        const legacyScope = oldScope && !isProgramLearningScope(oldScope) ? oldScope : undefined;
        let activeProgram: LearningProgram | undefined;
        if ((existingProgramScope || (!legacyScope &&
            (scopeCommand === "assessment" || scopeCommand === "focused"))) && this.programStore) {
          const collection = await this.programStore.load();
          activeProgram = collection.programs.find(item => item.id === collection.activeProgramId);
        }
        const wantsProgram = Boolean(existingProgramScope) || (!legacyScope &&
          (scopeCommand === "assessment" || scopeCommand === "focused"));
        let next = oldScope;
        const invalid = scopeCommand === "invalid";
        const unavailable = scopeCommand === "resume" &&
          (!oldScope || oldScope.mode !== "FREE" || !oldScope.resumeMode);
        let explanation: string | undefined;
        if (!invalid && !unavailable && wantsProgram) {
          if (existingProgramScope && scopeCommand === "free") {
            next = transitionProgramLearningScope(existingProgramScope, "free", existingProgramScope.programId);
          } else if (!activeProgram ||
              (existingProgramScope && existingProgramScope.programId !== activeProgram.id &&
                existingProgramScope.mode !== "FREE")) {
            explanation = "Select a learning program with /plan <goal> before starting assessment. If you switched programs, pause the old mode first.";
          } else {
            next = transitionProgramLearningScope(existingProgramScope, scopeCommand, activeProgram.id);
          }
        } else if (!invalid && !unavailable && legacyScope) {
          next = transitionLearningScope(legacyScope, scopeCommand);
        } else if (!invalid && !unavailable && !oldScope && scopeCommand !== "free") {
          explanation = "Create a learning program with /plan, then start a session before entering a learning mode.";
        }
        const programMode = isProgramLearningScope(next);
        const subject = programMode ? activeProgram?.goal ?? "learning program" : "backend";
        const question = next ? this.practiceForSession({ ...sessionAtStart,
          learningScope: next }).snapshot()?.currentQuestion : undefined;
        const reply = invalid
          ? "Gunakan /mode assessment, /mode focused, /pause, /mode free, atau /resume."
          : explanation ?? (unavailable
          ? "Tidak ada mode belajar yang dijeda."
          : !next || next.mode === "FREE"
            ? (next?.resumeMode ? `Mode bebas. Pertanyaan ${subject} disimpan; ketik /resume untuk melanjutkan.`
              : "Mode bebas. Gunakan /plan <goal> untuk memulai program belajar.")
            : `MODE: ${next.mode} · ${subject}. ${question ? `Kembali ke pertanyaan: ${question}`
              : programMode ? "Gunakan /start-session lalu /next untuk belajar." : "Kirim 'mulai' untuk pertanyaan backend pertama."} Ketik /pause untuk diskusi bebas.`);
        if (invalid || unavailable || explanation || !next ||
            (next === oldScope && scopeCommand === "free")) {
          if (!request.retry) await this.sessions.recordUserMessage(request.prompt, sessionAtStart.id, "ask", request.turnId);
          await this.sessions.recordAssistantMessage(reply, undefined, sessionAtStart.id);
        } else {
          await this.sessions.recordScopeChange(next, request.prompt, reply, sessionAtStart.id, request.turnId);
          this.practices.reset(sessionAtStart.id);
        }
        yield { type: "response-delta", text: reply };
        yield { type: "completed" };
      } catch (error) {
        yield { type: "failed", failure: { code: "persistence-failed",
          message: "Nox could not change the learning mode. Existing progress remains unchanged.",
          diagnostic: error instanceof Error ? error.message : String(error) } };
      } finally {
        if (this.activeTurn === activeTurn) this.activeTurn = null;
      }
      return;
    }
    const scope = sessionAtStart.learningScope;
    const legacyLockedMode = !isProgramLearningScope(scope) && isLockedLearningMode(scope?.mode)
      ? scope.mode : undefined;
    const programScope = isProgramLearningScope(scope) && scope.mode !== "FREE" ? scope : undefined;
    const lockedMode = legacyLockedMode ?? (programScope ? programScope.mode : undefined);
    const teachingProgramTurn = Boolean(programScope && request.programActivity?.kind === "teach");
    const strictPractice = Boolean(lockedMode) && !teachingProgramTurn &&
      !request.practiceClarification && !this.currentFocusPaused;
    if (strictPractice) {
      if (request.action === "edit" || request.action === "review") {
        try {
          const reply = scopeDeflection(this.practiceForSession(sessionAtStart).snapshot()?.currentQuestion,
            programScope ? "learning program" : undefined);
          if (!request.retry) await this.sessions.recordUserMessage(request.prompt, sessionAtStart.id, "practice", request.turnId);
          await this.sessions.recordAssistantMessage(reply, undefined, sessionAtStart.id);
          yield { type: "response-delta", text: reply };
          yield { type: "completed" };
        } catch {
          yield { type: "failed", failure: { code: "persistence-failed", message: "Nox could not save this response. Retry after checking storage." } };
        } finally {
          if (this.activeTurn === activeTurn) this.activeTurn = null;
        }
        return;
      }
      request = { ...request, action: "practice", sourcePath: undefined };
    }
    const editProposalId = request.action === "edit"
      ? `edit:${sessionAtStart.id}:${request.turnId ?? crypto.randomUUID()}`
      : undefined;
    const existingPractice = request.action === "practice" || request.practiceClarification
      ? this.practiceForSession(sessionAtStart)
      : undefined;
    const previousOrigin = existingPractice?.isWaitingForAnswer()
      ? existingPractice.snapshot()?.origin
      : undefined;
    const activePracticeTurn = existingPractice?.snapshot()?.turns.at(-1);
    const pinnedPracticeSource = request.action === "practice"
      ? (previousOrigin?.file ?? request.sourcePath)
      : undefined;
    const research = request.action === "ask" ? parseResearchRequest(request.prompt) : null;
    const researchQuery = research?.query ?? null;
    let researchResult: ResearchResult | undefined;
    let researchScope: ResearchScope | undefined;

    let context: LearningContext;
    let policy: Awaited<ReturnType<PolicyPort["load"]>>;
    let state: Awaited<ReturnType<LearningStatePort["load"]>>;
    let program: LearningProgram | undefined;
    let selectedSkill: { path: string; content: string } | null = null;

    try {
      const refs = [...request.explicitContext];
      if (this.programStore && (request.programActivity || ((request.action === "practice" && !request.freePractice &&
          (!activePracticeTurn || activePracticeTurn.programId)) || request.practiceClarification)) && !legacyLockedMode) {
        const collection = await this.programStore.load();
        program = collection.programs.find(item => item.id === collection.activeProgramId);
        if (programScope && programScope.programId !== program?.id) {
          throw new Error("This learning mode belongs to another program. Switch back or leave this mode.");
        }
        if (request.programActivity && (request.programActivity.programId !== program?.id ||
            !program.objectives.some(o => o.id === request.programActivity?.objectiveId))) {
          throw new Error("Teaching task does not match the active program.");
        }
        if (activePracticeTurn?.programId && activePracticeTurn.programId !== program?.id) {
          throw new Error("The active question belongs to another learning program. Switch back to that program before answering.");
        }
        if (activePracticeTurn?.questionSpec?.focusSessionId &&
            activePracticeTurn.questionSpec.focusSessionId !== program?.focus?.id) {
          throw new Error("This question belongs to a previous objective focus.");
        }
        if (program?.focus && (program.focus.status !== "active" ||
            program.focus.chatSessionId !== sessionAtStart.id ||
            (request.programActivity && request.programActivity.objectiveId !== program.focus.objectiveId))) {
          throw new Error("The persisted objective focus does not authorize this turn.");
        }
        if (program?.constraints.sourceBound && sessionAtStart.runtimeProvider !== "chatgpt") {
          throw new Error("Strict source-bound learning requires the ChatGPT provider without vault filesystem tools. Local CLI agents can read beyond selected notes.");
        }
        if (program?.constraints.sourceBound) {
          // Read only objective-specific, already approved sources when focus
          // or a pending challenge establishes which objective is authoritative.
          const sourceObjectiveId = program.focus?.objectiveId ??
            activePracticeTurn?.objectiveId ?? request.programActivity?.objectiveId;
          const sourceObjective = program.objectives.find(item => item.id === sourceObjectiveId &&
            !item.deprecated);
          const neededPaths = sourceObjective?.sourceRefs.length
            ? sourceObjective.sourceRefs : program.constraints.sourcePaths;
          for (const path of neededPaths) {
            if (!refs.some(ref => ref.kind === "vault-note" && ref.path === path)) {
              refs.push({ kind: "vault-note", path });
            }
          }
        }
      }
      const sourceRef = pinnedPracticeSource ?? request.sourcePath;
      if (sourceRef && !refs.some((ref) => ref.kind === "vault-note" && ref.path === sourceRef)) {
        refs.push({ kind: "vault-note", path: sourceRef });
      }
      // Filter user-provided attachments and unrelated vault references BEFORE
      // loading file bytes. Source boundaries are authorization, not relevance.
      if (program?.constraints.sourceBound) {
        const approved = new Set(program.constraints.sourcePaths);
        if (sourceRef && !approved.has(sourceRef)) {
          throw new Error("Practice source is outside the approved learning material.");
        }
        const scopedRefs = refs.filter(ref => ref.kind === "vault-note" && approved.has(ref.path));
        refs.splice(0, refs.length, ...scopedRefs);
      }
      // Independent vault reads share the same preflight window; required
      // source resolution and learning-policy failures still fail this turn.
      [context, [policy, state]] = await Promise.all([
        this.contexts.resolve(refs, { includeAmbient: request.contextMode !== "explicit-only" }),
        Promise.all([this.policies.load(), this.learningState.load()]),
      ]);
      state = await this.evidence.reconcileTranscript(sessionAtStart, state);
      if (researchQuery && research && this.contexts.searchKnowledge) {
        const selectedPaths = [
          ...context.explicit.filter(item => item.source === "explicit" && item.type === "note" &&
            !item.path.startsWith("attachment/")).map(item => item.path),
          ...(context.selection ? [context.selection.file] : []),
          ...(request.sourcePath ? [request.sourcePath] : []),
        ];
        // With no attached or selected notes, the open note is the selected source.
        if (!selectedPaths.length && context.activeNote) selectedPaths.push(context.activeNote.path);
        const scope = resolveResearchScope(research.scope, {
          selectedPaths,
          sourceBoundPaths: program?.constraints.sourceBound
            ? program.constraints.sourcePaths : undefined,
        });
        researchScope = scope;
        researchResult = await this.contexts.searchKnowledge(researchQuery, {
          limit: 8, scope,
        });
      }
      // Optional vault-authored skills are contextual material, never scope authority.
      // Strict locked practice and source-bound programs keep their original isolation.
      if (!strictPractice && !program?.constraints.sourceBound && this.policies.loadSkill) {
        const skillKind = researchQuery !== null ? "research"
          : request.action === "review" ? "review"
          : request.action === "explain" ? "teaching"
          : request.action === "practice" && program && !activePracticeTurn &&
              selectAdaptiveActivity(program, state, Date.now()).kind === "diagnostic"
            ? "assessment" : undefined;
        if (skillKind) selectedSkill = await this.policies.loadSkill(skillKind);
      }
    } catch (error) {
      if (this.activeTurn === activeTurn) this.activeTurn = null;
      const persistenceFailed = error instanceof PersistenceError;
      yield {
        type: "failed",
        failure: {
          code: persistenceFailed ? "persistence-failed" : "unknown",
          message: persistenceFailed
            ? "Nox could not save recovered learning progress. Check vault storage, then retry."
            : "Nox could not prepare this learning turn.",
          diagnostic:
            error instanceof Error
              ? error.message
              : String(error),
        },
      };
      return;
    }

    if (controller.signal.aborted) {
      this.activeTurn = null;
      yield { type: "cancelled" };
      return;
    }

    if (request.sourcePath && request.action === "edit") {
      const primary = context.selection?.file ?? context.activeNote?.path;
      if (primary !== request.sourcePath) {
        this.activeTurn = null;
        yield {
          type: "failed",
          failure: {
            code: "unknown",
            message: `Open ${request.sourcePath} before fixing this review finding.`,
          },
        };
        return;
      }
    }

    const resolvedContext = this.contexts.toAgentContext(context)
      .filter(item => !program?.constraints.sourceBound ||
        program.constraints.sourcePaths.includes(item.file));
    // A Review follow-up practices its originating material, even if the user
    // navigated to another note before sending. Other explicit refs remain additive.
    // An Ask AI quote never implicitly attaches another editor's selection.
    let visible = request.replyTo
      ? context.explicit.map(item => ({ type: item.type, file: item.path, content: item.content }))
      : resolvedContext;
    if (pinnedPracticeSource && request.action === "practice") {
      const source = resolvedContext.find((item) => item.file === pinnedPracticeSource);
      if (!source) {
        this.activeTurn = null;
        yield {
          type: "failed",
          failure: {
            code: "unknown",
            message: `Practice source ${pinnedPracticeSource} is no longer available.`,
          },
        };
        return;
      }
      const automaticPath = context.selection?.file ?? context.activeNote?.path;
      visible = [
        ...(previousOrigin?.selectedText
          ? [{ type: "selection" as const, file: source.file, content: previousOrigin.selectedText }]
          : [source]),
        ...resolvedContext.filter(
          (item) => item !== source && item.file !== automaticPath,
        ),
      ];
    }
    if (researchResult) {
      // Deliberate selections win; research excerpts outrank ambient whole-note content.
      const selected = visible.filter(item => item.type === "selection");
      const explicitPaths = new Set(request.explicitContext.map(ref =>
        ref.kind === "vault-note" ? ref.path : "attachment/" + ref.name));
      const explicitSources = visible.filter(item => explicitPaths.has(item.file));
      const ambient = visible.filter(item => item.type !== "selection" && !explicitPaths.has(item.file));
      const snippets: AgentContext[] = researchResult.hits.map(hit => ({
        type: "note", file: hit.path,
        content: "[Research evidence: " + hit.path + ":" + hit.line +
          " | section: " + hit.heading + " | revision: " + hit.revision + "]\n" + hit.content,
      }));
      visible = [...selected, ...snippets, ...explicitSources, ...ambient];
    }
    // The final provider envelope must respect the same read authority as search.
    // This also closes the reply-to explicit-context bypass for source-bound plans.
    const authority: ResearchScope | undefined = program?.constraints.sourceBound
      ? { kind: "selected", paths: program.constraints.sourcePaths }
      : researchScope;
    if (authority) visible = constrainResearchContext(visible, authority);
    let focusedContextDigest = "";
    if (program && !legacyLockedMode &&
        (request.action === "practice" || request.practiceClarification ||
          request.programActivity?.kind === "teach")) {
      const objectiveId = program.focus?.objectiveId ??
        activePracticeTurn?.objectiveId ?? request.programActivity?.objectiveId ??
        selectAdaptiveActivity(program, state, Date.now()).objective?.id;
      if (objectiveId) {
        try {
          const packageForTurn = buildLearningContextPackage({
            program, state, objectiveId, visible,
            approvedNotes: context.explicit.filter(item =>
              item.type === "note" && item.source === "explicit" &&
              !item.path.startsWith("attachment/"))
              .map(item => ({ path: item.path, content: item.content })),
            prompt: request.prompt, now: Date.now(),
          });
          visible = packageForTurn.visible;
          focusedContextDigest = packageForTurn.digest;
        } catch (error) {
          if (this.activeTurn === activeTurn) this.activeTurn = null;
          yield { type: "failed", failure: { code: "unknown",
            message: "NOX could not assemble authorized learning context. No provider call was made.",
            diagnostic: error instanceof Error ? error.message : String(error) } };
          return;
        }
      }
    }
    const system: AgentContext[] = [];
    if (selectedSkill?.content.trim()) {
      system.push({ type: "note", file: selectedSkill.path, content: selectedSkill.content });
    }

    if (policy.rawInstructions && !program?.constraints.sourceBound) {
      const alreadyIncluded = visible.some(
        (item) =>
          item.type === "note" &&
          item.file === policy.path,
      );

      if (!alreadyIncluded) {
        system.push({
          type: "note",
          file: policy.path,
          content: policy.rawInstructions,
        });
      }
    }

    if (!program) system.push({
      type: "note",
      file: "00-learning-os/progress.json",
      content: JSON.stringify(
        toPromptLearningState(state),
        null,
        2,
      ),
    });

    const authorizedSystem = authority
      ? constrainResearchContext(system, authority) : system;
    const readableFiles = Array.from(
      new Set(
        visible
          .filter(
            (item) =>
              !item.file.startsWith("attachment/"),
          )
          .map((item) => item.file),
      ),
    );

    const mutableFile =
      pinnedPracticeSource ??
      context.selection?.file ??
      context.activeNote?.path;

    const snapshot: TurnContextSnapshot = {
      resolved: context,
      visible,
      system: authorizedSystem,
      readableFiles,
      mutableFile,
    };

    const contextMs = performance.now() - runStartedAt;
    yield { type: "context-ready", context: snapshot };

    const conversation = this.sessions.getSession();
    const turnSessionId = conversation.id;
    const practice = this.practiceForSession(conversation);
    if (program && request.action === "practice" && !practice.isWaitingForAnswer() &&
        !program.session && program.focus?.status !== "active") {
      if (this.activeTurn === activeTurn) this.activeTurn = null;
      yield { type: "failed", failure: { code: "busy", message: "Start a timeboxed session with /start-session before practicing your program." } };
      return;
    }
    const decision = program && request.action === "practice" && !practice.isWaitingForAnswer()
      ? selectAdaptiveActivity(program, state, Date.now())
      : undefined;
    const objective: LearningObjective | undefined = decision?.objective;
    if (decision && (!objective || decision.kind === "timebox-ended" || decision.kind === "wait")) {
      if (this.activeTurn === activeTurn) this.activeTurn = null;
      yield { type: "failed", failure: { code: "busy",
        message: decision.reason + " Use /progress to inspect the current plan." } };
      return;
    }

    let preparedPrompt: string;
    let practiceAttempt:
      | PracticeEvaluationAttempt
      | undefined;

    if (request.action === "practice") {
      if (request.practiceSubmission && !practice.isWaitingForAnswer()) {
        if (this.activeTurn === activeTurn) this.activeTurn = null;
        yield { type: "failed", failure: { code: "protocol-invalid",
          message: "This question has already been answered or is no longer active." } };
        return;
      }
      if (practice.isWaitingForAnswer()) {
        const active = practice.snapshot()?.turns.at(-1);
        let textAnswer = request.prompt;
        if (request.practiceSubmission) {
          if (!active || active.id !== request.practiceSubmission.questionId || !active.questionSpec) {
            if (this.activeTurn === activeTurn) this.activeTurn = null;
            yield { type: "failed", failure: { code: "protocol-invalid",
              message: "This answer no longer matches the active question." } };
            return;
          }
          try { textAnswer = validatePracticeAnswer(active.questionSpec, request.practiceSubmission.answer); }
          catch (error) {
            if (this.activeTurn === activeTurn) this.activeTurn = null;
            yield { type: "failed", failure: { code: "protocol-invalid",
              message: error instanceof Error ? error.message : "Invalid quiz answer." } };
            return;
          }
        } else if (active?.questionSpec?.input && active.questionSpec.input.type !== "essay") {
          if (this.activeTurn === activeTurn) this.activeTurn = null;
          yield { type: "failed", failure: { code: "protocol-invalid",
            message: "Answer this question using its interactive card." } };
          return;
        }
        const attempt =
          practice.beginEvaluation(textAnswer);

        if (!attempt) {
          if (this.activeTurn === activeTurn) this.activeTurn = null;
          yield {
            type: "failed",
            failure: {
              code: "unknown",
              message:
                "The active practice question is no longer available.",
            },
          };
          return;
        }

        practiceAttempt = attempt;
        preparedPrompt =
          buildPracticeEvaluationInstruction({
            question: attempt.question,
            answer: attempt.answer,
            concept: attempt.concept,
            criteria: attempt.questionSpec?.input?.type === "essay" ||
              attempt.questionSpec?.input?.type === "code"
              ? attempt.questionSpec.input.criteria : undefined,
            codeLanguage: attempt.questionSpec?.input?.type === "code"
              ? attempt.questionSpec.input.language : undefined,
          });
      } else {
        const originFile = program?.constraints.sourceBound
          ? program.constraints.sourcePaths[0]
          : pinnedPracticeSource ?? context.selection?.file ?? context.activeNote?.path;
        const origin: PracticeOrigin | undefined = originFile
          ? { file: originFile,
              selectedText: context.selection?.file === originFile
                ? context.selection.content : undefined }
          : undefined;
        practice.start(origin);
        preparedPrompt =
          buildPracticeQuestionInstruction(
            request.prompt,
          );
      }
    } else {
      this.practices.reset(conversation.id);
      const instruction =
        buildActionInstruction(request.action);
      preparedPrompt =
        `${instruction}\n\nUser request:\n${request.replyTo
          ? formatReplyPrompt(researchQuery ?? request.prompt, request.replyTo)
          : researchQuery ?? request.prompt}`;
      if (request.action === "ask" || request.action === "explain") {
        preparedPrompt += "\n\nPRESENTATION: Use short semantic Markdown headings without numeric prefixes unless specifically requested. Prefer compact Markdown tables for comparisons. Avoid emoji as status icons. Do not invent metrics or display a chart for unknown data.";
        const graphPresentation = selectGraphPresentation(request.prompt);
        if (graphPresentation === "nox-flow") {
          preparedPrompt += /nox-flow\s*v1/i.test(request.prompt)
            ? '\nUse fenced nox-flow v1 JSON: version 1, direction TB, layout layered, nodes [{id,label}], edges [{from,to}]. Maximum 24 nodes and 48 edges, acyclic only.'
            : '\nUse fenced nox-flow v2 JSON: {"version":2,"direction":"TB","layout":"layered","groups":[{"id":"layer","label":"Application Layer"}],"nodes":[{"id":"one","label":"Service","group":"layer"},{"id":"two","label":"Database"}],"edges":[{"from":"one","to":"two","label":"reads"}]}. Use TB or LR, maximum 40 nodes, 80 edges, 8 non-empty groups, one group per node. Do not invent relationships.';
        } else if (graphPresentation === "mermaid") {
          preparedPrompt += '\nOutput a fenced mermaid flowchart TB or LR. Use compact descriptive node labels, faithful edges and logical branching. Avoid decorative subgraphs and invented relationships; use separate diagrams for independent lifecycles.';
        }
        if (/grafik|chart|breakdown|analytics|analitik|perbandingan metrik|metric card|comparison card/i.test(request.prompt)) {
          preparedPrompt += "\nFor verified numeric analytics, a fenced nox-chart JSON object supports {\"type\":\"horizontal-bar\",\"title\":\"Title\",\"labels\":[\"A\",\"B\"],\"values\":[12,7]}. For compact comparison, fenced nox-card JSON supports {\"version\":1,\"kind\":\"comparison\",\"title\":\"Title\",\"items\":[{\"label\":\"Before\",\"value\":12},{\"label\":\"After\",\"value\":7}]}. Never produce invented values.";
        }
      }
      if (researchQuery !== null) {
        preparedPrompt += "\n\nRESEARCH MODE (grounded, one-pass): " +
          "Use ONLY retrieved Obsidian excerpts as evidence. Cite sources as [[note path]] " +
          "with section/line when available. Distinguish observed evidence, inference, " +
          "conflicts, and unanswered questions. Do not claim web research, external " +
          "verification or graph relations that the evidence does not support. " +
          "If evidence is insufficient, say so.\nResearch questions: " +
          JSON.stringify(researchResult?.subquestions ?? [researchQuery]) +
          "\nSource link edges (metadata, not proof of a claim): " +
          JSON.stringify(researchResult?.edges ?? []);
      }
    }

    if (program && !legacyLockedMode && request.programActivity) {
      const topic = program.objectives.find(item => item.id === request.programActivity?.objectiveId);
      if (!topic) throw new Error("The teaching objective no longer exists.");
      preparedPrompt += "\n\nTeach this objective: " + topic.outcome +
        ". Rubric: " + JSON.stringify(topic.rubric) +
        ". Give a mental model, one worked example, and a guided check. Do not grade or claim mastery.";
    }
    if (program && !legacyLockedMode && request.action === "practice") {
      const activeObjective = practiceAttempt?.objectiveId
        ? program.objectives.find(item => item.id === practiceAttempt.objectiveId)
        : objective;
      if (activeObjective) {
        const lastEvidence = state.evidence.filter(item => item.scope === "learner" &&
          item.programId === program.id && item.objectiveId === activeObjective.id &&
          item.evidenceVersion === 3 &&
          item.objectiveRevision === (activeObjective.objectiveRevision ?? program.planVersion))
          .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).at(-1);
        const missed = lastEvidence?.rubricResults?.filter(result => !result.met).map(result => result.criterion) ?? [];
        const feedback = !practiceAttempt && lastEvidence?.evidenceVersion === 3 &&
          lastEvidence.objectiveRevision === (activeObjective.objectiveRevision ?? program.planVersion)
          ? decideFeedback(activeObjective, state.evidence, lastEvidence) : undefined;
        preparedPrompt += [
          "\n\nLEARNING PROGRAM CONTRACT (set by the application, not user-provided notes):",
          `Program ID: ${program.id}. Goal: ${program.goal}`,
          `Objective ID: ${activeObjective.id}. Outcome: ${activeObjective.outcome}`,
          `Required rubric: ${JSON.stringify(activeObjective.rubric)}`,
          `Activity: ${practiceAttempt ? "evaluate current answer" : decision?.kind}`,
          "For guided practice use appropriate scaffolding; for transfer test application in a new context.",
          `Previously failed rubric criteria: ${JSON.stringify(missed)}. If remedial practice, target these first.`,
          `Evidence-based feedback: ${JSON.stringify(feedback ?? { kind: "diagnostic" })}. Never claim mastery without independent delayed recall.`,
          `Application-selected activity: ${JSON.stringify(decision ? {
            kind: decision.kind, objectiveId: decision.objective?.id,
            provenance: decision.provenance,
          } : { kind: "evaluate-existing-question" })}. The model cannot change or override this choice.`,
          `Source constraint: ${program.constraints.sourceBound
            ? "Only the explicitly selected source note(s), do not claim external facts were verified."
            : "Use provided material where available and distinguish assumptions."}`,
          "Evaluate the specific objective only. Do not change topics or declare mastery.",
          "When generating, ask exactly one question and avoid revealing its answer.",
          "When evaluating, give specific rubric feedback and no follow-up nextQuestion; the application chooses the next objective.",
          "Include rubricResults as [{criterion: exact criterion from the rubric, met: boolean, evidence: supporting text from the answer}].",
        ].join("\n");
      }
    }
    if (strictPractice && legacyLockedMode) {
      preparedPrompt = buildScopedPracticeInstruction(legacyLockedMode, preparedPrompt, Boolean(practiceAttempt));
    } else if (strictPractice && programScope) {
      if (!program) throw new Error("The selected learning program is unavailable.");
      const activeObjectiveId = practiceAttempt?.objectiveId ?? objective?.id;
      const activeObjective = program.objectives.find(item => item.id === activeObjectiveId);
      preparedPrompt = buildProgramScopedPracticeInstruction({
        mode: programScope.mode as "ASSESSMENT" | "FOCUSED",
        goal: program.goal,
        objective: activeObjective,
        hasQuestion: Boolean(practiceAttempt),
      }, preparedPrompt);
    }
    if (request.practiceClarification) {
      if (!activePracticeTurn || activePracticeTurn.id !== request.practiceClarification.questionId ||
          !existingPractice?.isWaitingForAnswer()) {
        throw new Error("The question was answered or replaced before clarification.");
      }
      preparedPrompt += "\n\nQUESTION CLARIFICATION ONLY: " +
        activePracticeTurn.question + ". Explain the learner's uncertainty without revealing the answer. " +
        "Do not grade, emit practice-question/practice-evaluation, change focus, or claim mastery. " +
        "Keep the current question pending. Clarification counts as assistance.";
    }
    if (focusedContextDigest) {
      preparedPrompt += "\n\nOBJECTIVE-SCOPED LEARNING CONTEXT (derived only from current-revision committed evidence):\n" +
        focusedContextDigest + "\nUse only the attached approved note excerpts for source-grounded facts. " +
        "A previous hidden provider conversation or lossy chat digest is never evidence of mastery.";
    }
    const parser = new StructuredStreamParser();
    const scopedEvents: StructuredStreamEvent[] = [];

    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      activeTurn.cancelReason = "timeout";
      controller.abort();
    }, this.turnTimeoutMs);

    let visibleText = "";
    let thoughtText = "";
    let firstVisibleMs: number | undefined;
    let executionPhase: "agent" | "processing" = "agent";
    const structuredBuffer = new StructuredTurnBuffer(request, snapshot, practiceAttempt);
    const { reviewBuffer, practiceBuffer, proposalBuffer } = structuredBuffer;

    // Streamed text remains visible; a proposal cannot be actionable before
    // a successful terminal event and a durable transcript commit.
    const persistMappedEvent = (mapped: LearningEvent): void => {
      if (mapped.type === "response-delta") {
        visibleText += mapped.text;
        if (firstVisibleMs === undefined) firstVisibleMs = performance.now() - runStartedAt;
      }
      if (mapped.type === "thought-delta") thoughtText += mapped.text;
    };

    const rollbackPractice = () => {
      if (practiceAttempt) {
        practice.rollbackEvaluation(
          practiceAttempt,
        );
      }
    };

    try {
      // Retries after a failed save must not silently lose the user message.
      // A durable turn ID also prevents appending the same message twice.
      const missingRetryMessage = Boolean(request.retry && request.turnId &&
        !this.sessions.getSession().messages.some(message =>
          message.role === "user" && message.id === request.turnId));
      if (!request.regenerate && (!request.retry || missingRetryMessage)) {
        await this.sessions.recordUserMessage(request.prompt, turnSessionId, request.action,
          request.turnId, request.replyTo);
      }
      if (request.practiceClarification) practice.markClarificationUsed();

      // A retry replays a durable edit decision instead of invoking the model.
      // Settled proposals must never be reopened as pending.
      if (editProposalId) {
        const existing = this.sessions.getProposal(editProposalId);
        if (existing) {
          if (existing.state === "pending") {
            yield { type: "mutation-proposed",
              edit: { id: editProposalId, proposal: existing.proposal } };
          }
          yield { type: "completed" };
          return;
        }
      }

      if (request.action === "review" && request.turnId) {
        const reviewId = `review:${turnSessionId}:${request.turnId}`;
        const committed = findCommittedReview(this.sessions.getSession(), reviewId);
        if (committed) {
          yield { type: "review-findings", findings: committed.findings };
          yield { type: "completed" };
          return;
        }
      }

      // A previous attempt can commit the outcome but fail while projecting
      // progress. Do not invoke the model again and risk a different verdict.
      if (practiceAttempt) {
        const committed = findCommittedPracticeOutcome(
          this.sessions.getSession(), practiceAttempt.questionId,
        );
        if (committed) {
          practice.commitEvaluation(practiceAttempt, committed.evaluation, committed.nextQuestionId);
          yield { type: "practice-evaluation", evaluation: committed.evaluation,
            questionId: practiceAttempt.questionId };
          if (committed.evaluation.nextQuestion?.trim()) {
            yield {
              type: "practice-question",
              question: {
                kind: "question",
                concept: committed.evaluation.concept,
                question: committed.evaluation.nextQuestion.trim(),
              },
              questionId: committed.nextQuestionId,
            };
          }
          yield { type: "completed" };
          return;
        }
      }

      // MCQ verdict is deterministic. No provider may override its answer key.
      if (practiceAttempt?.questionSpec?.input?.type === "multiple-choice" &&
          request.practiceSubmission) {
        const graded = gradeMultipleChoice(practiceAttempt.questionSpec,
          request.practiceSubmission.answer);
        const evaluation: PracticeEvaluation = {
          ...graded, programId: practiceAttempt.programId,
          objectiveId: practiceAttempt.objectiveId,
          assisted: Boolean(practiceAttempt.assisted),
          focusSessionId: practiceAttempt.focusSessionId,
          assistance: { highestHintLevel: practiceAttempt.highestHintLevel,
            independent: practiceAttempt.highestHintLevel === 0 },
          evaluator: "deterministic",
          objectiveRevision: practiceAttempt.objectiveRevision,
          taskKind: practiceAttempt.taskKind,
          assessmentCoverage: practiceAttempt.programId ? "single-item" : undefined,
        };
        for await (const item of this.commitPracticeOutcome(
          evaluation, snapshot, turnSessionId, practice, practiceAttempt,
          (legacyLockedMode ? "backend" : programScope ? "program" : undefined),
        )) yield item;
        yield { type: "completed" };
        return;
      }

      const { envelope, conversationId, effectivePrompt, metrics } = prepareTurnInvocation({
        request, conversation, restrictedMode: Boolean(lockedMode), program,
        authority, snapshot, preparedPrompt,
        researchRequested: researchQuery !== null,
        researchHits: researchResult?.hits.length ?? 0,
        contextMs, runStartedAt,
      });
      // The runtime may still be authenticating or starting a CLI; do not claim
      // the model has received the request until output is observed.
      yield { type: "activity-phase", phase: "waiting-model", at: Date.now() };
      let receivedModelOutput = false;
      let regeneratedConversationId: string | undefined;
      const providerStartedAt = performance.now();
      for await (const event of this.runtime.send(
        { prompt: effectivePrompt, context: envelope.context },
        { model: conversation.model, conversationId, history: envelope.history },
        controller.signal,
      )) {
        if (event.type === "tool-started" || event.type === "tool-completed") {
          if (!strictPractice) yield event;
          continue;
        }
        if (event.type === "text") {
          if (!receivedModelOutput) {
            receivedModelOutput = true;
            yield { type: "activity-phase", phase: "receiving-output", at: Date.now() };
          }
          if (metrics.firstTokenMs === undefined) {
            metrics.firstTokenMs = performance.now() - startedAt;
            metrics.providerFirstTextMs = performance.now() - providerStartedAt;
          }
          executionPhase = "processing";
          if (strictPractice) {
            scopedEvents.push(...parser.push(event.content));
            executionPhase = "agent";
            continue;
          }
          for await (const mapped of structuredBuffer.map(parser.push(event.content))) {
            persistMappedEvent(mapped);
            yield mapped;
          }
          executionPhase = "agent";
          continue;
        }

        if (event.type === "completed") {
          metrics.providerDurationMs = performance.now() - providerStartedAt;
          yield { type: "activity-phase", phase: "finalizing", at: Date.now() };
          executionPhase = "processing";
          if (event.usage) {
            metrics.providerInputTokens = event.usage.inputTokens;
            metrics.providerOutputTokens = event.usage.outputTokens;
          }
          if (event.conversationId && !lockedMode && !program) {
            if (request.regenerate) regeneratedConversationId = event.conversationId;
            else await this.sessions.setConversationId(event.conversationId, turnSessionId);
          }

          let completedEvents = parser.finish();
          if (strictPractice) {
            scopedEvents.push(...completedEvents);
            if (controller.signal.aborted) {
              rollbackPractice();
              if (activeTurn.cancelReason === "timeout") {
                yield { type: "failed", failure: { code: "timeout", message: "Nox turn timed out before scope validation." } };
              } else yield { type: "cancelled" };
              return;
            }
            const decisions = scopedEvents.filter((item) => item.type === "scope-decision");
            const invalid = scopedEvents.some((item) => item.type === "error");
            if (invalid || decisions.length !== 1) {
              rollbackPractice();
              yield { type: "failed", failure: { code: "protocol-invalid",
                message: "Nox could not validate the response scope. The active question is unchanged; retry." } };
              return;
            }
            const decision = decisions[0];
            if (decision.outcome === "out-of-scope" || decision.outcome === "help") {
              rollbackPractice();
              let reply = scopeDeflection(practiceAttempt?.question, programScope ? program?.goal : undefined);
              if (decision.outcome === "help") {
                const text = scopedEvents.filter((item) => item.type === "text").map((item) => item.text).join("").trim();
                if (!practiceAttempt || !text || text.length > 1200 || scopedEvents.some((item) =>
                  item.type !== "text" && item.type !== "thought" && item.type !== "scope-decision")) {
                  yield { type: "failed", failure: { code: "protocol-invalid", message: "Nox returned invalid practice help. The question is unchanged; retry." } };
                  return;
                }
                reply = `${text}\n\nKembali ke pertanyaan: ${practiceAttempt.question}`;
              }
              await this.sessions.recordAssistantMessage(reply, snapshot.mutableFile, turnSessionId);
              yield { type: "response-delta", text: reply };
              yield { type: "completed" };
              return;
            }
            completedEvents = scopedEvents.filter((item) => item.type !== "text" && item.type !== "thought" && item.type !== "scope-decision");
            const expected = practiceAttempt ? "practice-evaluation" : "practice-question";
            if (completedEvents.length !== 1 || completedEvents[0].type !== expected) {
              rollbackPractice();
              yield { type: "failed", failure: { code: "protocol-invalid", message: "Nox returned an invalid scoped practice result. Retry the same question." } };
              return;
            }
          }
          for await (const mapped of structuredBuffer.map(completedEvents)) {
            persistMappedEvent(mapped);
            yield mapped;
          }

          // Cancel may race with a terminal event. Do not commit an aborted turn.
          if (controller.signal.aborted) {
            rollbackPractice();
            if (activeTurn.cancelReason === "timeout") {
              yield { type: "failed", failure: {
                code: "timeout",
                message: "Nox turn timed out before its result could be committed.",
              } };
            } else {
              yield { type: "cancelled" };
            }
            return;
          }

          // Candidate payloads become eligible only after successful terminal output.
          structuredBuffer.assertTerminalEligible();

          // A parsed question is only a candidate until the agent completes.
          // Never leave a durable or visible unanswered question after failure.
          if (program?.focus) await this.assertFocusAuthority(program.focus, turnSessionId);
          if (practiceBuffer.question) {
            practiceBuffer.question = program && objective
              ? { ...practiceBuffer.question, concept: objective.title, programId: program.id,
                  objectiveId: objective.id, focusSessionId: program.focus?.id,
                  objectiveRevision: objective.objectiveRevision ?? program.planVersion, taskKind: decision?.kind === "transfer" || decision?.kind === "recall" ||
                    decision?.kind === "guided-practice" ? decision.kind : "diagnostic" as const }
              : { ...practiceBuffer.question, programId: undefined, objectiveId: undefined };
            const questionId = crypto.randomUUID();
            await this.sessions.recordStructuredPart(
              { type: "practice-question", question: practiceBuffer.question,
                questionId, origin: practice.snapshot()?.origin,
                ...(strictPractice ? { scope: legacyLockedMode ? "backend" as const : "program" as const } : {}) },
              snapshot.mutableFile,
              turnSessionId,
            );
            practice.acceptQuestion(practiceBuffer.question, questionId);
            yield { type: "practice-question", question: practiceBuffer.question, questionId };
          }

          if (practiceAttempt && practiceBuffer.evaluation) {
            if (practiceAttempt.programId) {
              const objective = program?.objectives.find(o => o.id === practiceAttempt.objectiveId);
              if (!objective || !coversCriteria(objective.rubric, practiceBuffer.evaluation.rubricResults,
                  practiceBuffer.evaluation.outcome)) {
                throw new InvalidLearningOutputError("Evaluation did not fully and consistently assess the objective rubric.");
              }
            }
            const activeObjective = practiceAttempt.programId
              ? program?.objectives.find(item => item.id === practiceAttempt.objectiveId) : undefined;
            const rubricResults = activeObjective && practiceAttempt.objectiveRevision !== undefined
              ? practiceBuffer.evaluation.rubricResults?.map(result => ({
                  ...result, criterionId: criterionIdFor(activeObjective.id,
                    practiceAttempt.objectiveRevision!, activeObjective.rubric.indexOf(result.criterion)),
                })) : practiceBuffer.evaluation.rubricResults;
            const evaluation: PracticeEvaluation = {
              ...practiceBuffer.evaluation,
              programId: practiceAttempt.programId,
              objectiveId: practiceAttempt.objectiveId,
              focusSessionId: practiceAttempt.focusSessionId,
              objectiveRevision: practiceAttempt.objectiveRevision,
              rubricResults,
              nextQuestion: practiceAttempt.programId ? undefined : practiceBuffer.evaluation.nextQuestion,
              assisted: Boolean(practiceAttempt.assisted),
              assistance: { highestHintLevel: practiceAttempt.highestHintLevel,
                independent: practiceAttempt.highestHintLevel === 0 },
              evaluator: "llm-review",
              taskKind: practiceAttempt.taskKind,
            };
            for await (const mapped of this.commitPracticeOutcome(
              evaluation,
              snapshot,
              turnSessionId,
              practice,
              practiceAttempt,
              (legacyLockedMode ? "backend" : programScope ? "program" : undefined),
            )) {
              persistMappedEvent(mapped);
              yield mapped;
            }
          }

          if (
            practiceAttempt &&
            practice.snapshot()?.state ===
              "evaluating"
          ) {
            throw new InvalidLearningOutputError(
              "Agent completed without a practice evaluation.",
            );
          }

          if (reviewBuffer.observed && request.action === "review") {
            const source = snapshot.resolved.selection?.file ??
              snapshot.resolved.activeNote?.path ?? "learning-session";
            const reviewId = `review:${turnSessionId}:${request.turnId ?? crypto.randomUUID()}`;
            const committed = await this.sessions.recordReviewOutcome(
              { type: "review-findings", reviewId, findings: reviewBuffer.findings, sourcePath: source },
              source,
              turnSessionId,
            );
            const outcome = await this.evidence.appendSafely(before => recordReviewFindings(before, {
              findings: committed.findings, source: committed.sourcePath ?? source, reviewId,
            }));
            if (outcome.appended) yield { type: "learning-state-updated", state: outcome.state };
            yield { type: "review-findings", findings: committed.findings };
          }
          // Save the narrative and proposal atomically before UI gets Apply.
          if (proposalBuffer.proposal) {
            if (!editProposalId || !snapshot.mutableFile) {
              throw new Error("Edit outcome requires an authorized source and turn ID.");
            }
            const committed = await this.sessions.recordEditOutcome(
              editProposalId, proposalBuffer.proposal, visibleText,
              snapshot.mutableFile, turnSessionId,
            );
            visibleText = "";
            if (committed.state === "pending") {
              yield { type: "mutation-proposed",
                edit: { id: editProposalId, proposal: committed.proposal } };
            }
          }
          const elapsedMs = performance.now() - runStartedAt;
          metrics.elapsedMs = elapsedMs;
          if (firstVisibleMs !== undefined) metrics.firstVisibleMs = firstVisibleMs;
          if (request.regenerate) {
            await this.sessions.recordRegeneratedResponse(
              request.regenerate.messageIndex,
              request.regenerate.expectedContent,
              { content: visibleText, sourcePath: snapshot.mutableFile,
                thought: thoughtText.trim() || undefined, elapsedMs },
              turnSessionId,
              regeneratedConversationId,
              metrics,
            );
          } else {
            await this.sessions.recordAssistantMessage(
              visibleText,
              snapshot.mutableFile,
              turnSessionId,
              thoughtText.trim() || undefined,
              elapsedMs,
              metrics,
            );
          }
          yield { type: "completed" };
          return;
        }

        if (event.type === "failed") {
          rollbackPractice();
          yield {
            type: "failed",
            failure: event.failure,
          };
          return;
        }

        rollbackPractice();

        if (activeTurn.cancelReason === "timeout") {
          const seconds = Math.max(
            1,
            Math.ceil(this.turnTimeoutMs / 1000),
          );
          yield {
            type: "failed",
            failure: {
              code: "timeout",
              message:
                `AI turn exceeded its ${seconds}s hard deadline. Progress is preserved; retry or choose a faster model.`,
            },
          };
        } else {
          yield { type: "cancelled" };
        }
        return;
      }

      if (practiceAttempt) {
        rollbackPractice();
      }
    } catch (error) {
      rollbackPractice();
      if (activeTurn.cancelReason === "timeout") {
        yield { type: "failed", failure: { code: "timeout",
          message: `AI request exceeded the ${Math.ceil(this.turnTimeoutMs / 1000)}s hard deadline. Retry or choose a faster model.` } };
        return;
      }
      if (activeTurn.cancelReason === "user" || activeTurn.cancelReason === "dispose") {
        yield { type: "cancelled" };
        return;
      }

      const persistenceFailed = error instanceof PersistenceError;
      const failure: AgentFailure = {
        code: persistenceFailed ? "persistence-failed"
          : error instanceof InvalidLearningOutputError ? "protocol-invalid"
          : executionPhase === "agent" ? "process-failed" : "unknown",
        message: persistenceFailed
          ? "Nox could not save this turn. Retry after checking vault storage."
          : error instanceof InvalidLearningOutputError
            ? "The agent returned an invalid result for this action. Retry the turn."
            : executionPhase === "agent"
            ? "The agent process failed during this turn."
            : "Nox could not complete this learning operation.",
        diagnostic: persistenceFailed
          ? error.diagnostic
          : error instanceof Error ? error.message : String(error),
      };

      yield { type: "failed", failure };
    } finally {
      clearTimeout(timeout);
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    if (!this.activeTurn) return;
    this.activeTurn.cancelReason = "user";
    this.activeTurn.controller.abort();
  }

  dispose(): void {
    this.practices.clear();
    if (!this.activeTurn) return;
    this.activeTurn.cancelReason = "dispose";
    this.activeTurn.controller.abort();
  }

  /**
   * The transcript is the canonical outcome. This method runs only after a
   * successful agent terminal event and complete structured-stream validation.
   */
  private async *commitPracticeOutcome(
    evaluation: PracticeEvaluation,
    context: TurnContextSnapshot,
    sessionId: string,
    practice: PracticeStateMachine,
    practiceAttempt: PracticeEvaluationAttempt,
    scoped?: "backend" | "program",
  ): AsyncIterable<LearningEvent> {
        const source =
          practiceAttempt.origin?.file ??
          context.resolved.selection?.file ??
          context.resolved.activeNote?.path ??
          "learning-session";

        const nextText = evaluation.nextQuestion?.trim();
        const nextQuestion: PracticeQuestion | undefined = nextText
          ? { kind: "question", concept: evaluation.concept, question: nextText }
          : undefined;
        const nextId = nextQuestion ? crypto.randomUUID() : undefined;
        if (practiceAttempt.focusSessionId) {
          if (!this.programStore) throw new Error("Focus persistence is unavailable.");
          const collection = await this.programStore.load();
          const current = collection.programs.find(p => p.id === practiceAttempt.programId);
          if (!current?.focus || current.focus.id !== practiceAttempt.focusSessionId) {
            throw new Error("Cannot commit evaluation from a replaced objective focus.");
          }
          await this.assertFocusAuthority(current.focus, sessionId);
        }
        const operationId = `practice:${sessionId}:${practiceAttempt.questionId}`;
        const parts: TranscriptPart[] = [
          { type: "practice-evaluation", evaluation: evaluation,
            questionId: practiceAttempt.questionId, operationId,
            nextQuestionId: nextId, sourcePath: source,
            ...(scoped ? { scope: scoped } : {}) },
          ...(nextQuestion ? [{
            type: "practice-question" as const, question: nextQuestion,
            questionId: nextId, origin: practice.snapshot()?.origin,
            ...(scoped ? { scope: scoped } : {}),
          }] : []),
        ];
        const committed = await this.sessions.recordPracticeOutcome(
          parts, operationId, source, sessionId,
        );
        const evaluationPart = committed.find((part) => part.type === "practice-evaluation");
        if (!evaluationPart || evaluationPart.type !== "practice-evaluation") {
          throw new Error("Committed practice outcome missing evaluation");
        }
        const projection = await this.evidence.appendSafely(before => recordPracticeEvaluation(before, {
          evaluation: evaluationPart.evaluation,
          source: evaluationPart.sourcePath ?? source,
          evidenceId: operationId,
          programId: evaluationPart.evaluation.programId,
          objectiveId: evaluationPart.evaluation.objectiveId,
          assisted: evaluationPart.evaluation.assisted,
          questionId: evaluationPart.questionId,
        }));
        const nextState = projection.state;

        practice.commitEvaluation(practiceAttempt, evaluationPart.evaluation, evaluationPart.nextQuestionId);
        yield { type: "practice-evaluation", evaluation: evaluationPart.evaluation,
          questionId: practiceAttempt.questionId };
        yield { type: "learning-state-updated", state: nextState };
        if (evaluationPart.evaluation.nextQuestion?.trim()) {
          yield { type: "practice-question", question: {
            kind: "question", concept: evaluationPart.evaluation.concept,
            question: evaluationPart.evaluation.nextQuestion.trim(),
          }, questionId: evaluationPart.nextQuestionId };
        }

  }

}
