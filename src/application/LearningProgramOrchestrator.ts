import type { AgentRuntimePort } from "../agent/AgentRuntime";
import type { ContextPort, LearningStatePort, ProgramStorePort } from "./ports";
import type { LearningProgram, ProgramCollection, ProgramConstraints, LearningDecision, SessionPauseReason } from "../domain/learning-program/types";
import { chooseNextActivity, feasibility, objectiveProgress, validateConstraints, validateCurriculum } from "../domain/learning-program/rules";
import { startObjectiveFocus, transitionObjectiveFocus } from "../domain/learning-program/focus-transitions";
import { applyCurriculumRevision, proposeRemediationRevision } from "../domain/learning-program/curriculum-revision";
import { applyStructuralRevision, previewStructuralRevision,
  type StructuralRevisionAction, type StructuralRevisionProposal,
  type StructuralRevisionPreview } from "../domain/learning-program/structural-revision";
import { estimateRemainingWork } from "../domain/learning-program/estimate";
import { checkpointTiming, focusSessionObjective, focusSessionMaterial, newSessionTiming, projectedTiming, recoverTiming, sessionRemainingMs, sessionTimeStatus, setTimingPause } from "../domain/learning-program/session-time";

/** Program planning and session selection. The model generates content, never transitions. */
export class LearningProgramOrchestrator {
  private readonly preparedDrafts = new Map<string, LearningProgram>();
  private readonly pendingRevisions = new Map<string, {
    proposal: StructuralRevisionProposal; preview: StructuralRevisionPreview; preparedAt: number;
  }>();
  private planning = false;
  private writing = false;
  private currentAbort?: AbortController;
  private mutationTail: Promise<void> = Promise.resolve();
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
    await this.mutationTail;
    await this.checkpointCurrentSession();
  }

  private async checkpointCurrentSession(): Promise<void> {
    const current = await this.getActiveProgram();
    if (!current?.session) { this.stopCheckpointLoop(); return; }
    const timing = current.session.timing;
    if (!timing || (timing.pauseReasons.length > 0 && !timing.pauseReasons.includes("ai-running"))) return;
    await this.updateActive(program => {
      if (!program.session?.timing) return program;
      return { ...program, session: { ...program.session,
        timing: checkpointTiming(program.session.timing, this.now()) } };
    });
  }

  /** Never infer closed-app time from a persisted wall-clock timestamp. */
  async recoverSessions(): Promise<void> {
    const collection = await this.store.load();
    let changed = false;
    const now = this.now();
    for (const program of collection.programs) {
      if (program.focus?.status === "active") {
        program.focus = { ...program.focus, status: "paused", pausedAt: now };
        changed = true;
      }
      if (program.session) {
        program.session = { ...program.session, timing: recoverTiming(program.session, now) };
        changed = true;
      }
    }
    if (changed) await this.store.save(collection);
    this.stopCheckpointLoop();
  }

  async getSessionTime(): Promise<{
    budgetMs: number; activeMs: number; remainingMs: number; aiWaitingMs: number;
    status: "active" | "waiting-ai" | "paused" | "recovered" | "exhausted";
  } | null> {
    const program = await this.getActiveProgram();
    if (!program?.session || program.focus) return null;
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
    await this.updateActive(program => {
      if (!program.session) throw new Error("No active learning session.");
      const now = this.now();
      const previous = program.session.timing ?? recoverTiming(program.session, now);
      return { ...program, session: { ...program.session,
        timing: setTimingPause(previous, reason, paused, now) } };
    });
  }

  async focusObjective(objectiveId: string): Promise<void> {
    await this.updateActive(program => {
      if (program.focus && program.focus.objectiveId !== objectiveId) throw new Error("Focused objective cannot change.");
      if (program.focus && !program.session) return program;
      if (!program.session) throw new Error("Start a session before studying an objective.");
      if (!program.objectives.some(o => o.id === objectiveId)) throw new Error("Unknown objective.");
      const now = this.now();
      const timing = program.session.timing ?? recoverTiming(program.session, now);
      return { ...program, session: { ...program.session,
        timing: focusSessionObjective(timing, objectiveId, now) } };
    });
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
      return { ...current, session: { ...current.session,
        timing: focusSessionMaterial(current.session.timing, path, this.now()) } };
    });
  }

  /** Preserve per-material attribution after an Obsidian note rename. */
  async renameMaterial(oldPath: string, newPath: string): Promise<void> {
    const op = this.mutationTail.then(async () => {
      this.writing = true;
      try {
        const collection = await this.store.load();
        let dirty = false;
        for (const program of collection.programs) {
          if (program.session?.timing) {
            const t = program.session.timing;
            if (t.focusMaterialPath === oldPath) { t.focusMaterialPath = newPath; dirty = true; }
            if (t.materialActiveMs?.[oldPath] !== undefined) {
              t.materialActiveMs[newPath] = (t.materialActiveMs[newPath] ?? 0) + t.materialActiveMs[oldPath];
              delete t.materialActiveMs[oldPath]; dirty = true;
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
        if (dirty) await this.store.save(collection);
      } finally { this.writing = false; }
    });
    this.mutationTail = op.then(() => {}, () => {});
    return op;
  }

  async setAppInactive(inactive: boolean): Promise<void> {
    const program = await this.getActiveProgram();
    if (!program?.session) return;
    await this.setPause("app-inactive", inactive);
  }

  async pauseSession(): Promise<void> { await this.setPause("manual", true); }
  async resumeSession(): Promise<void> {
    await this.updateActive(program => {
      if (!program.session) throw new Error("No active learning session.");
      const now = this.now();
      let timing = program.session.timing ?? recoverTiming(program.session, now);
      timing = setTimingPause(timing, "manual", false, now);
      timing = setTimingPause(timing, "recovery", false, now);
      return { ...program, session: { ...program.session, timing } };
    });
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

  isPlanning() { return this.planning || this.writing; }
  cancel() { this.currentAbort?.abort(); }
  async listPrograms(): Promise<ProgramCollection> { return this.store.load(); }
  async selectProgram(id: string): Promise<LearningProgram> {
    if (this.isPlanning() || this.activeAiTurnId) throw new Error("Finish the current learning operation before switching programs.");
    const operation = this.mutationTail.then(async () => {
      this.writing = true;
      try {
        const collection = await this.store.load();
        const selected = collection.programs.find(p => p.id === id);
        if (!selected) throw new Error("Unknown program ID. Run /programs to list saved plans.");
        if (collection.programs.some(p => p.id !== id && p.focus?.status === "active")) {
          throw new Error("Pause or end the active focus before switching programs.");
        }
        const previous = collection.programs.find(p => p.id === collection.activeProgramId);
        const now = this.now();
        if (previous?.session) {
          previous.session = { ...previous.session, timing: recoverTiming(previous.session, now) };
        }
        if (selected.session) {
          selected.session = { ...selected.session, timing: recoverTiming(selected.session, now) };
        }
        collection.activeProgramId = id;
        await this.store.save(collection);
        return selected;
      } finally { this.writing = false; }
    });
    this.mutationTail = operation.then(() => {}, () => {});
    const selected = await operation;
    this.stopCheckpointLoop();
    return selected;
  }
  async getActiveProgram(): Promise<LearningProgram | null> {
    const collection = await this.store.load();
    return collection.programs.find(p => p.id === collection.activeProgramId) ?? null;
  }
  private updateActive(edit: (program: LearningProgram) => LearningProgram | Promise<LearningProgram>): Promise<LearningProgram> {
    if (this.planning) return Promise.reject(new Error("Curriculum generation is in progress."));
    // Serialize the read-modify-write operation, not only the underlying vault write.
    const operation = this.mutationTail.then(async () => {
      this.writing = true;
      try {
        const collection = await this.store.load();
        const index = collection.programs.findIndex(p => p.id === collection.activeProgramId);
        if (index === -1) throw new Error("No active learning program. Use /plan first.");
        const next = await edit(structuredClone(collection.programs[index]));
        collection.programs[index] = next;
        await this.store.save(collection);
        return next;
      } finally { this.writing = false; }
    });
    this.mutationTail = operation.then(() => {}, () => {});
    return operation;
  }
  /** Show a typed, versioned diff before any structural curriculum write. */
  async previewStructuralChange(action: StructuralRevisionAction,
    rationale: string, operationId: string): Promise<StructuralRevisionPreview> {
    if (this.isPlanning() || this.activeAiTurnId) {
      throw new Error("Finish the current learning operation before revising.");
    }
    const active = await this.getActiveProgram();
    if (!active) throw new Error("Choose a learning program first.");
    const proposal: StructuralRevisionProposal = {
      operationId, programId: active.id, baseVersion: active.planVersion,
      rationale, action: structuredClone(action),
    };
    const preview = previewStructuralRevision(active, proposal);
    this.pendingRevisions.set(operationId, {
      proposal: structuredClone(proposal), preview: structuredClone(preview),
      preparedAt: this.now(),
    });
    return preview;
  }

  /** No approval is applied without its exact non-expired preview. */
  async approveStructuralChange(operationId: string): Promise<LearningProgram> {
    if (this.isPlanning() || this.activeAiTurnId) {
      throw new Error("Finish the current learning operation before approving curriculum changes.");
    }
    const pending = this.pendingRevisions.get(operationId);
    if (!pending) {
      const existing = await this.getActiveProgram();
      if (existing?.curriculumRevisions?.some(item => item.operationId === operationId)) return existing;
      throw new Error("No matching preview. Preview the revision again.");
    }
    if (this.now() - pending.preparedAt > 15 * 60_000) {
      this.pendingRevisions.delete(operationId);
      throw new Error("Curriculum preview expired. Generate a fresh preview.");
    }
    const result = await this.updateActive(program => {
      if (program.id !== pending.proposal.programId) {
        throw new Error("Active program changed after preview.");
      }
      const updated = applyStructuralRevision(program, pending.proposal);
      const applied = updated.curriculumRevisions?.at(-1);
      if (!applied || JSON.stringify(applied.after) !== JSON.stringify(pending.preview.after) ||
          applied.fromVersion !== pending.preview.fromVersion) {
        throw new Error("Curriculum proposal drifted since preview.");
      }
      return updated;
    });
    this.pendingRevisions.delete(operationId);
    return result;
  }

  /** Derived from committed rubric failures; never mutate an in-progress objective. */
  async replanFromEvidence(): Promise<LearningProgram | null> {
    const state = await this.learningState.load();
    const active = await this.getActiveProgram();
    if (!active) throw new Error("Choose a learning program first.");
    if (active.focus) throw new Error("End objective focus before revising the curriculum.");
    const proposal = proposeRemediationRevision(active, state.evidence);
    if (!proposal) return null;
    return this.updateActive(program => applyCurriculumRevision(program, proposal));
  }

  async startFocus(objectiveId: string, chatSessionId?: string): Promise<LearningProgram> {
    const state = await this.learningState.load();
    return this.updateActive(program => {
      const objective = program.objectives.find(item => item.id === objectiveId);
      if (!objective || objective.deprecated) throw new Error("Unknown or deprecated objective ID.");
      if (!objective.prerequisiteIds.every(id =>
        objectiveProgress(program, id, state.evidence, this.now()).status === "mastered")) {
        throw new Error("Master the prerequisite objectives before focusing this objective.");
      }
      return startObjectiveFocus(program, objectiveId, this.now(), crypto.randomUUID(), chatSessionId);
    });
  }
  async pauseFocus(): Promise<LearningProgram> {
    return this.updateActive(p => transitionObjectiveFocus(p, "pause", this.now()));
  }
  async resumeFocus(): Promise<LearningProgram> {
    return this.updateActive(p => transitionObjectiveFocus(p, "resume", this.now()));
  }
  async endFocus(): Promise<LearningProgram> {
    // Focus transition and a conservative micro-replan commit in one serialized
    // programs.json write. A failed save leaves both state changes unapplied.
    return this.updateActive(async program => {
      const completed = program.focus;
      const ended = transitionObjectiveFocus(program, "end", this.now());
      if (!completed) return ended;
      const learning = await this.learningState.load();
      const proposal = proposeRemediationRevision(ended, learning.evidence, {
        completedFocusId: completed.id, objectiveId: completed.objectiveId,
      });
      return proposal ? applyCurriculumRevision(ended, proposal) : ended;
    });
  }
  async startSession(): Promise<LearningProgram> {
    const result = await this.updateActive(program => {
      if (program.session) throw new Error("A study session is already active. Use /end-session before starting another.");
      const now = this.now();
      return { ...program,
        session: { startedAt: now, timeBudgetMinutes: program.constraints.minutesPerSession,
          timing: newSessionTiming(now) } };
    });
    this.startCheckpointLoop();
    const context = await this.contexts.resolve().catch(() => null);
    if (context?.activeNote?.path) await this.focusMaterial(context.activeNote.path);
    return result;
  }
  async extendSession(minutes: number): Promise<LearningProgram> {
    return this.updateActive(program => {
      if (!program.session) throw new Error("Start a session before extending its timebox.");
      if (!Number.isInteger(minutes) || minutes < 5 ||
          program.session.timeBudgetMinutes + minutes > 240) {
        throw new Error("Extension must be at least 5 minutes; total timebox must not exceed 240.");
      }
      program.session.timeBudgetMinutes += minutes;
      return program;
    });
  }
  async endSession(): Promise<LearningProgram> {
    const result = await this.updateActive(program => {
      if (!program.session) throw new Error("No active session to end.");
      const endedAt = this.now();
      const startedAt = program.session.startedAt;
      const minutesSpent = Math.max(0, (endedAt - startedAt) / 60_000);
      const finalTiming = projectedTiming(program.session, endedAt);
      return { ...program, session: undefined, sessionHistory: [
        ...(program.sessionHistory ?? []), {
          startedAt, endedAt, minutesSpent,
          ...(finalTiming ? {
            activeMinutes: finalTiming.activeMs / 60_000,
            aiWaitingMinutes: finalTiming.aiWaitingMs / 60_000,
            ...(finalTiming.dailyActiveMs ? { dailyActiveMs: finalTiming.dailyActiveMs } : {}),
            ...(finalTiming.materialActiveMs ? {
              materialActiveMinutes: Object.fromEntries(Object.entries(finalTiming.materialActiveMs)
                .map(([path, ms]) => [path, ms / 60_000])),
            } : {}),
            ...(finalTiming.objectiveActiveMs ? {
              objectiveActiveMinutes: Object.fromEntries(Object.entries(finalTiming.objectiveActiveMs)
                .map(([id, ms]) => [id, ms / 60_000])),
            } : {}),
          } : {}),
        },
      ] };
    });
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
  async getDecision(): Promise<{ program: LearningProgram; decision: LearningDecision } | null> {
    const program = await this.getActiveProgram();
    if (!program) return null;
    const state = await this.learningState.load();
    return { program, decision: chooseNextActivity(program, state.evidence) };
  }
  async reviewDueSummary(): Promise<string> {
    const program = await this.getActiveProgram();
    if (!program) return "No active learning program.";
    const state = await this.learningState.load();
    const { objectiveProgress } = await import("../domain/learning-program/rules");
    const now = Date.now();
    const due = program.objectives.filter(item => {
      const p = objectiveProgress(program, item.id, state.evidence, now);
      return p.dueAt !== null && p.dueAt <= now;
    });
    return due.length ? "Reviews due:\n" + due.map(item => "- " + item.title).join("\n") :
      "No reviews are due. Use /progress for the next scheduled activity.";
  }

  async progressSummary(): Promise<string> {
    const result = await this.getDecision();
    if (!result) return "No active learning program. Use /plan <goal> to create one.";
    const { program, decision } = result;
    const state = await this.learningState.load();
    const { objectiveProgress } = await import("../domain/learning-program/rules");
    const activeObjectives = program.objectives.filter(o => !o.deprecated);
    const mastered = activeObjectives.filter(o =>
      objectiveProgress(program, o.id, state.evidence).status === "mastered").length;
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
      `Confirmed active learning: ${Math.round(spent)} minutes, ${program.sessionHistory?.length ?? 0} completed sessions.`,
      ...(historicalLegacy ? [`Older sessions without activity accounting: ${historicalLegacy} (excluded from active time).`] : []),
      ...(currentTiming ? [`AI waiting this session: ${Math.round(currentTiming.aiWaitingMs / 60_000)} minutes.`] : []),
      `Mastered: ${mastered}/${activeObjectives.length} active objectives (requires independent delayed recall)`,
      `Plan: ~${f.estimatedMinutes} minutes including estimated review; available: ${f.availableMinutes ?? "unspecified"} minutes.`,
      `Feasibility: ${estimate}`,
      `Remaining work: ~${remainingEstimate.minutes} min (${remainingEstimate.basis}${remainingEstimate.basis === "calibrated" ? `, ${remainingEstimate.samples} measured objectives` : ""}).`,
      `Next: ${decision.kind} — ${decision.objective?.title ?? decision.reason}`,
      ...(program.focus ? [`Objective focus: ${program.focus.status} — ${program.focus.objectiveId}`,
        "Use /pause-focus, /resume-focus, or /end-focus to manage this lock."] :
        ["Start self-paced learning with /focus <objective-id>."]),
      "Objectives: " + program.objectives.map(item => item.id + " (" + item.title + ")").join(", "),
      ...(decision.dueAt ? [`Review due: ${new Date(decision.dueAt).toLocaleString()}`] : []),
      ...(program.focus ? [] :
        [`Session remaining: ${decision.minutesRemaining ?? program.constraints.minutesPerSession} minutes`]),
    ].join("\n");
  }

  /** Preview only; no program is persisted until the learner approves. */
  async prepareProgram(goal: string, requested: ProgramConstraints): Promise<LearningProgram> {
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
      if (constraints.sourceBound && this.currentProvider() !== "chatgpt") {
        throw new Error("A source-limited curriculum requires a provider without local vault-file access.");
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
    const op = this.mutationTail.then(async () => {
      this.writing = true;
      try {
        const collection = await this.store.load();
        const previous = collection.programs.find(p => p.creationOperationId === operationId);
        if (previous) return previous;
        // Activation is a global focus mutation, including onboarding approval.
        // Paused focus is preserved and allows switching per the focus contract.
        if (collection.programs.some(p => p.focus?.status === "active")) {
          throw new Error("Pause or end the active focus before activating a new program.");
        }
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
        collection.programs.push(program);
        collection.activeProgramId = program.id;
        await this.store.save(collection);
        this.preparedDrafts.delete(draftId);
        return program;
      } finally { this.writing = false; }
    });
    this.mutationTail = op.then(() => {}, () => {});
    return op;
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
