import type { AgentRuntimePort } from "../agent/AgentRuntime";
import type { ContextPort, LearningStatePort, ProgramStorePort } from "./ports";
import type { LearningProgram, ProgramCollection, ProgramConstraints, SessionPauseReason } from "../domain/learning-program/types";
import { feasibility, validateConstraints, validateCurriculum } from "../domain/learning-program/rules";
import { selectAdaptiveActivity, type AdaptiveActivityDecision } from "../domain/learner-model/activity-policy";
import { deriveLearnerProfile, toLearnerProfileContext } from "../domain/learner-model/learner-profile";
import { applyCurriculumRevision, detectStructuralGap, type CurriculumRevision, type StructuralGapReason } from "../domain/learning-program/curriculum-revision";
import { proposeCurriculumRevision, type CurriculumRevisionPreview } from "./CurriculumRevisionService";
import { estimateRemainingWork } from "../domain/learning-program/estimate";
import { projectedTiming, recoverTiming, sessionRemainingMs, sessionTimeStatus } from "../domain/learning-program/session-time";
import { ProgramMutationQueue } from "./ProgramMutationQueue";
import { beginObjectiveFocus, changeObjectiveFocus } from "./ProgramFocusService";
import {
  startTimedSession, endTimedSession, extendTimedSession, pauseTimedSession,
  resumeTimedSession, focusTimedObjective, focusTimedMaterial,
  checkpointTimedSession, recoverProgramSessions,
} from "./ProgramSessionTransitions";

/** Program planning and session selection. The model generates content, never transitions. */
export class LearningProgramOrchestrator {
  private readonly preparedDrafts = new Map<string, LearningProgram>();
  private readonly pendingRevisions = new Map<string, { revision: CurriculumRevision; preview: CurriculumRevisionPreview }>();
  private planning = false;
  private currentAbort?: AbortController;
  private readonly mutations = new ProgramMutationQueue();
  // Runtime-owned timer (not bound to a DOM window): safe across Obsidian popout views.
  private checkpointTimer?: ReturnType<typeof setInterval>;
  private activeAiTurnId?: string;
  constructor(private readonly runtime: AgentRuntimePort, private readonly contexts: ContextPort,
    private readonly learningState: LearningStatePort, private readonly store: ProgramStorePort,
    private readonly currentModel: () => string | undefined,
    private readonly currentProvider: () => string | undefined = () => undefined,
    private readonly now: () => number = () => Date.now()) {}

  dispose(): void {
    if (this.checkpointTimer !== undefined) clearInterval(this.checkpointTimer);
    this.checkpointTimer = undefined;
    this.cancel();
    this.preparedDrafts.clear();
    this.pendingRevisions.clear();
  }

  private startCheckpointLoop(): void {
    if (this.checkpointTimer !== undefined) return;
    this.checkpointTimer = setInterval(() => {
      if (!this.isPlanning()) void this.checkpointCurrentSession().catch(() => {
        // Keep the prior durable checkpoint; explicit commands report persistence failures.
      });
    }, 30_000);
  }

  private stopCheckpointLoop(): void {
    if (this.checkpointTimer !== undefined) clearInterval(this.checkpointTimer);
    this.checkpointTimer = undefined;
  }

  async flushTime(): Promise<void> {
    await this.mutations.idle();
    await this.checkpointCurrentSession();
  }

  private async checkpointCurrentSession(): Promise<void> {
    const current = await this.getActiveProgram();
    if (!current?.session) { this.stopCheckpointLoop(); return; }
    const timing = current.session.timing;
    if (!timing || (timing.pauseReasons.length > 0 && !timing.pauseReasons.includes("ai-running"))) return;
    await this.updateActive(program => checkpointTimedSession(program, this.now()));
  }

  /** Never infer closed-app time from a persisted wall-clock timestamp. */
  async recoverSessions(): Promise<void> {
    await this.mutations.run(async () => {
      const expected = await this.store.load();
      const now = this.now();
      const changed = expected.programs.some(program => program.focus?.status === "active" || Boolean(program.session));
      if (!changed) return;
      const next: ProgramCollection = { ...expected,
        programs: expected.programs.map(program => recoverProgramSessions(program, now)) };
      await this.store.save(next, expected);
    });
    this.stopCheckpointLoop();
  }

  async getSessionTime(): Promise<{
    budgetMs: number; activeMs: number; remainingMs: number; aiWaitingMs: number;
    status: "active" | "waiting-ai" | "paused" | "recovered" | "exhausted";
  } | null> {
    const program = await this.getActiveProgram();
    if (!program?.session) return null;
    const current = projectedTiming(program.session, this.now());
    return {
      budgetMs: program.session.timeBudgetMinutes * 60_000,
      activeMs: current?.activeMs ?? 0,
      remainingMs: sessionRemainingMs(program.session, this.now()),
      aiWaitingMs: current?.aiWaitingMs ?? 0,
      status: sessionTimeStatus(program.session, this.now()),
    };
  }

  private async setPause(reason: SessionPauseReason, paused: boolean): Promise<void> {
    await this.updateActive(program => pauseTimedSession(program, reason, paused, this.now()));
  }

  async focusObjective(objectiveId: string): Promise<void> {
    await this.updateActive(program => focusTimedObjective(program, objectiveId, this.now()));
  }

  async setIdle(idle: boolean): Promise<void> {
    const program = await this.getActiveProgram();
    if (!program?.session) return;
    if (Boolean(program.session.timing?.pauseReasons.includes("idle")) === idle) return;
    await this.setPause("idle", idle);
  }

  async focusMaterial(path: string): Promise<void> {
    const program = await this.getActiveProgram();
    if (!program?.session || !path || !path.toLowerCase().endsWith(".md")) return;
    if (program.session.timing?.focusMaterialPath === path) return;
    await this.updateActive(current => {
      if (!current.session?.timing) return current;
      return focusTimedMaterial(current, path, this.now());
    });
  }

  /** Preserve per-material attribution after an Obsidian note rename. */
  async renameMaterial(oldPath: string, newPath: string): Promise<void> {
    return this.mutations.run(async () => {
      const expected = await this.store.load();
      const next = structuredClone(expected);
      let dirty = false;
      for (const program of next.programs) {
        if (program.session?.timing) {
          const timing = program.session.timing;
          if (timing.focusMaterialPath === oldPath) { timing.focusMaterialPath = newPath; dirty = true; }
          if (timing.materialActiveMs?.[oldPath] !== undefined) {
            timing.materialActiveMs[newPath] = (timing.materialActiveMs[newPath] ?? 0) + timing.materialActiveMs[oldPath];
            delete timing.materialActiveMs[oldPath]; dirty = true;
          }
        }
        for (const history of program.sessionHistory ?? []) {
          if (history.materialActiveMinutes?.[oldPath] !== undefined) {
            history.materialActiveMinutes[newPath] =
              (history.materialActiveMinutes[newPath] ?? 0) + history.materialActiveMinutes[oldPath];
            delete history.materialActiveMinutes[oldPath]; dirty = true;
          }
        }
      }
      if (dirty) await this.store.save(next, expected);
    });
  }

  async setAppInactive(inactive: boolean): Promise<void> {
    const program = await this.getActiveProgram();
    if (!program?.session) return;
    await this.setPause("app-inactive", inactive);
  }

  async pauseSession(): Promise<void> { await this.setPause("manual", true); }
  async resumeSession(): Promise<void> {
    await this.updateActive(program => resumeTimedSession(program, this.now()));
    this.startCheckpointLoop();
  }

  /** Per-turn token prevents accidental repeated finish and double counting. */
  async beginAiWait(runId: string): Promise<boolean> {
    if (this.activeAiTurnId === runId) return false;
    if (this.activeAiTurnId) throw new Error("A timed AI turn is already running.");
    const program = await this.getActiveProgram();
    if (!program?.session) return false;
    await this.setPause("ai-running", true);
    this.activeAiTurnId = runId;
    this.startCheckpointLoop();
    return true;
  }

  async finishAiWait(runId: string): Promise<void> {
    if (this.activeAiTurnId !== runId) return;
    try {
      await this.setPause("ai-running", false);
    } finally {
      // Persistent timing may need recovery, but the in-memory turn is over.
      this.activeAiTurnId = undefined;
    }
  }

  isPlanning() { return this.planning || this.mutations.isWriting; }
  cancel() { this.currentAbort?.abort(); }
  async listPrograms(): Promise<ProgramCollection> { return this.store.load(); }
  async selectProgram(id: string): Promise<LearningProgram> {
    if (this.isPlanning() || this.activeAiTurnId) throw new Error("Finish the current learning operation before switching programs.");
    const selected = await this.mutations.run(async () => {
      const expected = await this.store.load();
      const next = structuredClone(expected);
      const chosen = next.programs.find(program => program.id === id);
      if (!chosen) throw new Error("Unknown program ID. Run /programs to list saved plans.");
      if (next.programs.some(program => program.id !== id && program.focus?.status === "active")) {
        throw new Error("Pause or end the active objective focus before switching learning programs.");
      }
      const previous = next.programs.find(program => program.id === next.activeProgramId);
      const now = this.now();
      if (previous?.session) previous.session = { ...previous.session, timing: recoverTiming(previous.session, now) };
      if (chosen.session) chosen.session = { ...chosen.session, timing: recoverTiming(chosen.session, now) };
      next.activeProgramId = id;
      await this.store.save(next, expected);
      return chosen;
    });
    this.stopCheckpointLoop();
    return selected;
  }

  /** Evidence opens the revision workflow but never bypasses explicit approval. */
  async detectRevisionCandidate() {
    const program = await this.getActiveProgram();
    if (!program) return null;
    const state = await this.learningState.load();
    return detectStructuralGap(program, state.evidence);
  }

  async prepareCurriculumRevision(reason?: "goal-change"): Promise<CurriculumRevisionPreview> {
    if (this.isPlanning() || this.activeAiTurnId) {
      throw new Error("Finish the active learning operation before preparing a structural revision.");
    }
    const program = await this.getActiveProgram();
    if (!program) throw new Error("Choose a learning program first.");
    if (program.focus || program.session) {
      throw new Error("End the objective focus and timed session before revising the curriculum.");
    }
    if (program.constraints.sourceBound && !this.runtime.supportsSourceIsolation?.()) {
      throw new Error("Source-bound revision requires an isolated provider with no vault filesystem tools.");
    }
    // Strict source-bound proposal: only trusted, explicitly resolved allowlist notes
    // may contribute source text; no implicit active-note or filesystem expansion.
    const sourceMaterials: Array<{ path: string; content: string }> = [];
    if (program.constraints.sourceBound) {
      const refs = program.constraints.sourcePaths.map(path => ({ kind: "vault-note" as const, path }));
      const resolved = await this.contexts.resolve(refs);
      for (const path of program.constraints.sourcePaths) {
        const approved = resolved.explicit.find(item =>
          item.type === "note" && item.source === "explicit" && item.path === path);
        if (!approved?.content) {
          throw new Error("Approved source note could not be resolved. Revision preview aborted.");
        }
        sourceMaterials.push({ path, content: approved.content.slice(0, 12_000) });
      }
    }
    const state = await this.learningState.load();
    const trigger = reason === "goal-change"
      ? { reason: "goal-change" as StructuralGapReason, evidenceIds: [] }
      : detectStructuralGap(program, state.evidence);
    if (!trigger) throw new Error("No evidence-backed structural gap. Use /replan goal-change for a requested scope change.");
    this.planning = true;
    const controller = this.currentAbort = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const { revision, preview } = await proposeCurriculumRevision(this.runtime, program,
        state.evidence, trigger, this.currentModel(), this.now(), controller.signal, sourceMaterials)
        .then(result => ({ revision: result.proposal, preview: result.preview }));
      this.pendingRevisions.clear();
      this.pendingRevisions.set(revision.operationId, { revision, preview });
      return structuredClone(preview);
    } finally {
      clearTimeout(timeout);
      this.currentAbort = undefined;
      this.planning = false;
    }
  }

  /** Revert is a new version. Never delete receipts or evidence from the past. */
  async prepareCurriculumRevert(targetOperationId: string): Promise<CurriculumRevisionPreview> {
    if (this.isPlanning() || this.activeAiTurnId || this.mutations.isWriting) {
      throw new Error("Finish the active learning operation before reverting.");
    }
    const program = await this.getActiveProgram();
    if (!program || program.focus || program.session) {
      throw new Error("End focus and legacy sessions before preparing a revert.");
    }
    const revision: CurriculumRevision = {
      id: crypto.randomUUID(), operationId: crypto.randomUUID(),
      programId: program.id, baseVersion: program.planVersion,
      reason: "goal-change", reasonEvidenceIds: [],
      operations: [{ kind: "revert", targetOperationId }],
    };
    const now = this.now();
    const after = applyCurriculumRevision(program, revision, [], now).objectives;
    const preview: CurriculumRevisionPreview = {
      operationId: revision.operationId, programId: program.id,
      fromVersion: program.planVersion, toVersion: program.planVersion + 1,
      reason: "goal-change", reasonEvidenceIds: [],
      operations: structuredClone(revision.operations),
      expiresAt: now + 15 * 60_000,
      before: structuredClone(program.objectives), after,
    };
    this.pendingRevisions.clear();
    this.pendingRevisions.set(revision.operationId, { revision, preview });
    return structuredClone(preview);
  }

  /** Read-only in-process approval proposal. Never resurrect an expired or stale diff. */
  peekCurriculumRevision(program: LearningProgram): CurriculumRevisionPreview | undefined {
    for (const candidate of this.pendingRevisions.values()) {
      const { revision, preview } = candidate;
      if (revision.programId === program.id &&
          revision.baseVersion === program.planVersion &&
          !program.focus && !program.session &&
          this.now() <= preview.expiresAt) return structuredClone(preview);
    }
    return undefined;
  }

  async approveCurriculumRevision(operationId: string): Promise<LearningProgram> {
    if (this.isPlanning() || this.activeAiTurnId) {
      throw new Error("Finish the running learning operation before approving a curriculum revision.");
    }
    return this.mutations.run(async () => {
      const expected = await this.store.load();
      const index = expected.programs.findIndex(program => program.id === expected.activeProgramId);
      if (index < 0) throw new Error("No active program for revision.");
      const program = expected.programs[index];
      if (program.curriculumRevisions?.some(revision => revision.operationId === operationId)) return program;
      const pending = this.pendingRevisions.get(operationId);
      if (!pending || this.now() > pending.preview.expiresAt ||
          pending.revision.programId !== program.id) {
        throw new Error("Revision preview expired or belongs to another program.");
      }
      const evidence = (await this.learningState.load()).evidence;
      const nextProgram = applyCurriculumRevision(program, pending.revision, evidence, this.now());
      if (JSON.stringify(nextProgram.objectives) !== JSON.stringify(pending.preview.after)) {
        throw new Error("Curriculum revision no longer matches the approved diff.");
      }
      const next: ProgramCollection = { ...expected,
        programs: expected.programs.map((item, position) => position === index ? nextProgram : item) };
      await this.store.save(next, expected);
      this.pendingRevisions.delete(operationId);
      return nextProgram;
    });
  }

  cancelCurriculumRevision(operationId: string): void {
    this.pendingRevisions.delete(operationId);
  }

  async getActiveProgram(): Promise<LearningProgram | null> {
    const collection = await this.store.load();
    return collection.programs.find(p => p.id === collection.activeProgramId) ?? null;
  }
  /** Persist a single program-scoped focus; evidence and question ownership stay elsewhere. */
  private async assertNoActiveFocus(): Promise<void> {
    if ((await this.store.load()).programs.some(p => p.focus?.status === "active")) {
      throw new Error("Pause or end the active objective focus before creating a different learning program.");
    }
  }

  async getFocus(): Promise<LearningProgram["focus"] | undefined> {
    return (await this.getActiveProgram())?.focus;
  }

  async getGlobalActiveFocus(): Promise<{ program: LearningProgram; focus: NonNullable<LearningProgram["focus"]> } | null> {
    const collection = await this.store.load();
    const program = collection.programs.find(item => item.focus?.status === "active");
    return program?.focus ? { program, focus: program.focus } : null;
  }

  async startFocus(objectiveId: string, chatSessionId: string): Promise<LearningProgram> {
    const state = await this.learningState.load();
    return this.updateActive(program => beginObjectiveFocus(
      program, state, objectiveId, chatSessionId, this.now(), crypto.randomUUID()));
  }

  async pauseFocus(): Promise<LearningProgram> {
    return this.updateActive(program => changeObjectiveFocus(program, "pause", this.now()));
  }

  async resumeFocus(chatSessionId: string): Promise<LearningProgram> {
    return this.updateActive(program => changeObjectiveFocus(program, "resume", this.now(), chatSessionId));
  }

  async endFocus(): Promise<LearningProgram> {
    return this.updateActive(program => changeObjectiveFocus(program, "end", this.now()));
  }

  private updateActive(edit: (program: LearningProgram) => LearningProgram): Promise<LearningProgram> {
    if (this.planning) return Promise.reject(new Error("Curriculum generation is in progress."));
    return this.mutations.run(async () => {
      const expected = await this.store.load();
      const index = expected.programs.findIndex(program => program.id === expected.activeProgramId);
      if (index === -1) throw new Error("No active learning program. Use /plan first.");
      const nextProgram = edit(structuredClone(expected.programs[index]));
      const next: ProgramCollection = { ...expected,
        programs: expected.programs.map((item, position) => position === index ? nextProgram : item) };
      await this.store.save(next, expected);
      return nextProgram;
    });
  }

  async startSession(): Promise<LearningProgram> {
    const result = await this.updateActive(program => startTimedSession(program, this.now()));
    this.startCheckpointLoop();
    const context = await this.contexts.resolve().catch(() => null);
    if (context?.activeNote?.path) await this.focusMaterial(context.activeNote.path);
    return result;
  }

  async extendSession(minutes: number): Promise<LearningProgram> {
    return this.updateActive(program => extendTimedSession(program, minutes));
  }

  async endSession(): Promise<LearningProgram> {
    const result = await this.updateActive(program => endTimedSession(program, this.now()));
    this.activeAiTurnId = undefined;
    this.stopCheckpointLoop();
    return result;
  }

  async markTaught(objectiveId: string, afterEvidenceAt: number): Promise<void> {
    await this.updateActive(program => {
      if (!program.objectives.some(item => item.id === objectiveId)) {
        throw new Error("Cannot record teaching for an unknown learning objective.");
      }
      if (!program.instructionEvents?.some(item =>
          item.objectiveId === objectiveId && item.afterEvidenceAt === afterEvidenceAt)) {
        program.instructionEvents = [...(program.instructionEvents ?? []),
          { objectiveId, afterEvidenceAt, taughtAt: Date.now() }];
      }
      return program;
    });
  }
  async getDecision(): Promise<{ program: LearningProgram; decision: AdaptiveActivityDecision } | null> {
    const program = await this.getActiveProgram();
    if (!program) return null;
    const state = await this.learningState.load();
    return { program, decision: selectAdaptiveActivity(program, state, this.now()) };
  }
  async reviewDueSummary(): Promise<string> {
    const program = await this.getActiveProgram();
    if (!program) return "No active learning program.";
    const state = await this.learningState.load();
    const profile = deriveLearnerProfile(program, state, this.now());
    const dueIds = new Set(profile.objectives
      .filter(item => item.dueAt !== null && item.dueAt <= this.now())
      .map(item => item.objectiveId));
    const due = program.objectives.filter(item => !item.deprecated && dueIds.has(item.id));
    return due.length ? "Reviews due:\n" + due.map(item => "- " + item.title).join("\n") :
      "No reviews are due. Use /progress for the next scheduled activity.";
  }

  async learnerProfileSummary(): Promise<string> {
    const program = await this.getActiveProgram();
    if (!program) return "No active learning program.";
    const state = await this.learningState.load();
    const profile = deriveLearnerProfile(program, state, this.now());
    const context = toLearnerProfileContext(profile);
    return [
      "Derived learner profile (read-only; only committed evidence):",
      "Program: " + program.goal + " (revision " + program.planVersion + ")",
      "Evidence entries: " + profile.evidenceCount,
      ...context.objectives.map(o => [
        "- " + o.objectiveId + " [" + o.status + ", r" + o.revision + "]",
        ...o.criteria.map(c => "  • " + c.id + ": " + c.status +
          (c.evidenceIds.length ? " (evidence " + c.evidenceIds.join(", ") + ")" : " (no evidence)")),
      ].join("\n")),
      "Unknown means insufficient verified evidence, not a negative ability judgment.",
    ].join("\n");
  }

  async progressSummary(): Promise<string> {
    const result = await this.getDecision();
    if (!result) return "No active learning program. Use /plan <goal> to create one.";
    const { program, decision } = result;
    const state = await this.learningState.load();
    const profile = deriveLearnerProfile(program, state, this.now());
    const mastered = profile.objectives.filter(item => item.status === "mastered").length;
    const f = feasibility(program);
    const remainingEstimate = estimateRemainingWork(program, state.evidence, this.now());
    const historicalActive = (program.sessionHistory ?? []).reduce((sum, item) => sum + (item.activeMinutes ?? 0), 0);
    const historicalLegacy = (program.sessionHistory ?? []).filter(item => item.activeMinutes === undefined).length;
    const currentTiming = program.session ? projectedTiming(program.session, this.now()) : null;
    const spent = historicalActive + (currentTiming?.activeMs ?? 0) / 60_000;
    const estimate = f.feasible === null ? "No deadline set" :
      f.feasible ? "Within estimated time budget" :
      "At risk: estimated work exceeds available time. Reduce scope or adjust deadline/time budget.";
    return [
      `Program: ${program.goal}`,
      "Learner evidence profile: use /learner-profile to inspect verified, provisional and unknown criteria.",
      ...(detectStructuralGap(program, state.evidence) && !program.focus ?
        ["Evidence suggests a structural gap. Use /replan to preview a validated change."] : []),
      ...(program.focus ? [`Focus: ${program.focus.status} on ${program.focus.objectiveId} (revision ${program.focus.curriculumRevision}).`] : []),
      `Objectives: ${program.objectives.map(o => o.id + " — " + o.title).join("; ")}`,
      `Confirmed active learning: ${Math.round(spent)} minutes, ${program.sessionHistory?.length ?? 0} completed sessions.`,
      ...(historicalLegacy ? [`Older sessions without activity accounting: ${historicalLegacy} (excluded from active time).`] : []),
      ...(currentTiming ? [`AI waiting this session: ${Math.round(currentTiming.aiWaitingMs / 60_000)} minutes.`] : []),
      `Mastered: ${mastered}/${profile.objectives.length} active objectives (requires independent delayed recall)`,
      `Estimated work: ~${f.estimatedMinutes} minutes including review (not a focus deadline).`,
      `Feasibility: ${estimate}`,
      `Remaining work: ~${remainingEstimate.minutes} min (${remainingEstimate.basis}${remainingEstimate.basis === "calibrated" ? `, ${remainingEstimate.samples} measured objectives` : ""}).`,
      `Next: ${decision.kind} — ${decision.objective?.title ?? decision.reason}`,
      ...(decision.provenance ? [
        `Policy: ${decision.provenance.trigger}` +
          (decision.provenance.criterionIds.length
            ? ` (criteria ${decision.provenance.criterionIds.join(", ")})` : ""),
      ] : []),
      ...(decision.dueAt ? [`Review due: ${new Date(decision.dueAt).toLocaleString()}`] : []),
      ...(program.focus ? ["Focus is self-paced; no mandatory timer."] :
        [`Session remaining: ${decision.minutesRemaining ?? program.constraints.minutesPerSession} minutes`]),
    ].join("\n");
  }

  /** Preview only; no program is persisted until the learner approves. */
  async prepareProgram(goal: string, requested: ProgramConstraints): Promise<LearningProgram> {
    await this.assertNoActiveFocus();
    if (this.isPlanning()) throw new Error("Another learning program operation is in progress.");
    if (!goal.trim()) throw new Error("Learning goal is required.");
    this.planning = true;
    const abort = this.currentAbort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 300_000);
    try {
      const context = await this.contexts.resolve();
      const source = context.selection ?? (context.activeNote ? {
        file: context.activeNote.path, content: context.activeNote.content,
      } : undefined);
      const constraints: ProgramConstraints = structuredClone(requested);
      if (constraints.sourceBound) {
        if (!source) throw new Error("Open or select a source note before using sources=active.");
        if (constraints.sourcePaths.length > 0 && !constraints.sourcePaths.includes(source.file)) {
          throw new Error("Source note changed during onboarding. Reopen the approved note and retry.");
        }
        constraints.sourcePaths = [source.file];
      }
      validateConstraints(constraints);
      if (constraints.sourceBound && !this.runtime.supportsSourceIsolation?.()) {
        throw new Error("A source-limited curriculum requires an isolated provider with no vault filesystem tools.");
      }
      const instruction = [
        "You create domain-agnostic learning programs by backward design.",
        "Convert the given goal into testable competencies, not a generic list of topics.",
        "Emit EXACTLY one fenced \`\`\`learning-program JSON block, no other output.",
        "Schema: {\"kind\":\"curriculum\",\"objectives\":[{\"id\":\"stable_slug\",\"title\":\"short\",\"outcome\":\"observable testable outcome\",\"prerequisiteIds\":[],\"estimatedMinutes\":45,\"rubric\":[\"observable success criterion\"],\"sourceRefs\":[],\"priority\":\"core\"}]}",
        "Prioritize 3–12 achievable objectives, in a directed acyclic prerequisite graph.",
        "Use priority core/supporting/optional. Rubrics must be testable.",
        "Do not invent user constraints or claim a skill is already mastered.",
        constraints.sourceBound
          ? "SOURCE-BOUND. Every objective must cite only the allowed exact source path: " + constraints.sourcePaths.join(", ") +
            ". Do not include external concepts unsupported by the provided material."
          : "The program is not source-bound; sourceRefs may be empty.",
        `Excluded topics: ${constraints.excludedTopics.join(", ") || "(none)"}`,
        `Goal: ${goal}`,
        `Constraint data: ${JSON.stringify(constraints)}`,
        source ? `Current source (${source.file}):\n${source.content.slice(0, 16000)}` : "",
      ].join("\n\n");
      let output = "", completed = false;
      const messages = this.runtime.send({ prompt: instruction, context: [] },
        { model: this.currentModel() }, abort.signal);
      for await (const event of messages) {
        if (abort.signal.aborted) throw new Error("Curriculum generation timed out.");
        if (event.type === "failed") throw new Error(event.failure.message);
        if (event.type === "cancelled") throw new Error("Curriculum generation cancelled.");
        if (event.type === "text") {
          output += event.content;
          if (output.length > 250_000) throw new Error("Curriculum response exceeded safety limit.");
        }
        if (event.type === "completed") { completed = true; break; }
      }
      if (abort.signal.aborted) throw new Error("Curriculum generation cancelled or timed out.");
      if (!completed) throw new Error("The agent did not complete the curriculum.");
      const blocks = [...output.matchAll(/```learning-program\s*\n([\s\S]*?)\n```/g)];
      if (blocks.length !== 1 || output.trim() !== blocks[0][0].trim()) {
        throw new Error("Expected exactly one structured curriculum, without extra output.");
      }
      let value: unknown;
      try { value = JSON.parse(blocks[0][1]); }
      catch { throw new Error("Curriculum is not valid JSON."); }
      const draft = validateCurriculum(value, constraints);
      const program: LearningProgram = {
        version: 1, id: crypto.randomUUID(), goal: goal.trim(), constraints,
        objectives: draft.objectives, createdAt: this.now(), planVersion: 1,
      };
      if (abort.signal.aborted) throw new Error("Curriculum generation cancelled before preview.");
      this.preparedDrafts.clear();
      this.preparedDrafts.set(program.id, structuredClone(program));
      return structuredClone(program);
    } finally { clearTimeout(timeout); this.planning = false; this.currentAbort = undefined; }
  }

  /** Commit a specific validated preview; retries with one operationId never duplicate programs. */
  async commitPrepared(draftId: string, operationId: string, workspaceApproved = false): Promise<LearningProgram> {
    if (!operationId.trim()) throw new Error("Operation ID is required.");
    if (this.isPlanning()) throw new Error("Finish preparing the curriculum before approval.");
    return this.mutations.run(async () => {
      const expected = await this.store.load();
      if (expected.programs.some(program => program.focus?.status === "active")) {
        throw new Error("Pause or end objective focus before changing learning plans.");
      }
      const previous = expected.programs.find(program => program.creationOperationId === operationId);
      if (previous) return previous;
      const proposed = this.preparedDrafts.get(draftId);
      if (!proposed) throw new Error("The preview expired. Generate a fresh learning blueprint.");
      if (this.now() - proposed.createdAt > 15 * 60_000) {
        this.preparedDrafts.delete(draftId);
        throw new Error("The preview expired. Generate a fresh learning blueprint.");
      }
      const program: LearningProgram = {
        ...structuredClone(proposed), creationOperationId: operationId,
        ...(workspaceApproved ? { workspaceApproved: true } : {}),
      };
      const next: ProgramCollection = { ...expected,
        programs: [...expected.programs, program], activeProgramId: program.id };
      await this.store.save(next, expected);
      this.preparedDrafts.delete(draftId);
      return program;
    });
  }

  /** Preserve the existing explicit /plan command behavior. */
  async createProgram(goal: string, requested: ProgramConstraints, operationId?: string): Promise<LearningProgram> {
    if (operationId) {
      const existing = (await this.store.load()).programs.find(p => p.creationOperationId === operationId);
      if (existing) return existing;
    }
    const draft = await this.prepareProgram(goal, requested);
    return this.commitPrepared(draft.id, operationId ?? crypto.randomUUID());
  }

  /** Domain-neutral discovery uses one bounded provider call; suggestions never become learning evidence. */
  async discoverGoals(interests: string[], purpose: string): Promise<Array<{ title: string; outcome: string }>> {
    await this.assertNoActiveFocus();
    if (this.isPlanning()) throw new Error("Another learning operation is in progress.");
    this.planning = true;
    const abort = this.currentAbort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 90_000);
    try {
      const instruction = [
        "Recommend three distinct realistic learning directions for a user who has not chosen a goal.",
        "Domain neutral. No invented personal traits, experience or skill claims.",
        'Return ONLY one JSON object: {"directions":[{"title":"imperative learning goal","outcome":"testable practical outcome"}]}',
        "Interests: " + JSON.stringify(interests.slice(0, 6)),
        "Motivation: " + purpose.slice(0, 80),
      ].join("\n");
      let output = "", completed = false;
      for await (const event of this.runtime.send({ prompt: instruction, context: [] }, { model: this.currentModel() }, abort.signal)) {
        if (event.type === "failed") throw new Error(event.failure.message);
        if (event.type === "cancelled") throw new Error("Discovery cancelled.");
        if (event.type === "text") {
          output += event.content;
          if (output.length > 20_000) throw new Error("Discovery output exceeded limit.");
        }
        if (event.type === "completed") { completed = true; break; }
      }
      if (!completed || abort.signal.aborted) throw new Error("Discovery request did not complete.");
      const parsed: unknown = JSON.parse(output.trim());
      const value = parsed as { directions?: unknown };
      if (!Array.isArray(value?.directions) || value.directions.length !== 3 ||
          !value.directions.every((d: unknown) => {
            const item = d as { title?: unknown; outcome?: unknown };
            return typeof item?.title === "string" && item.title.trim().length >= 5 &&
              item.title.length <= 140 && typeof item.outcome === "string" &&
              item.outcome.trim().length >= 5 && item.outcome.length <= 300;
          })) throw new Error("Invalid discovery result.");
      return value.directions as Array<{ title: string; outcome: string }>;
    } finally { clearTimeout(timeout); this.planning = false; this.currentAbort = undefined; }
  }
}
