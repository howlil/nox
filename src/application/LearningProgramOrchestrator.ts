import type { AgentRuntimePort } from "../agent/AgentRuntime";
import type { ContextPort, LearningStatePort, ProgramStorePort } from "./ports";
import type { LearningProgram, ProgramCollection, ProgramConstraints, LearningDecision, SessionPauseReason } from "../domain/learning-program/types";
import { chooseNextActivity, feasibility, validateConstraints, validateCurriculum } from "../domain/learning-program/rules";
import { checkpointTiming, focusSessionObjective, newSessionTiming, projectedTiming, recoverTiming, sessionRemainingMs, sessionTimeStatus, setTimingPause } from "../domain/learning-program/session-time";

/** Program planning and session selection. The model generates content, never transitions. */
export class LearningProgramOrchestrator {
  private planning = false;
  private writing = false;
  private currentAbort?: AbortController;
  private mutationTail: Promise<void> = Promise.resolve();
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
      if (!program.session) continue;
      program.session = { ...program.session, timing: recoverTiming(program.session, now) };
      changed = true;
    }
    if (changed) await this.store.save(collection);
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
      if (!program.session) throw new Error("Start a session before studying an objective.");
      if (!program.objectives.some(o => o.id === objectiveId)) throw new Error("Unknown objective.");
      const now = this.now();
      const timing = program.session.timing ?? recoverTiming(program.session, now);
      return { ...program, session: { ...program.session,
        timing: focusSessionObjective(timing, objectiveId, now) } };
    });
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
    await this.setPause("ai-running", false);
    this.activeAiTurnId = undefined;
  }

  isPlanning() { return this.planning || this.writing; }
  cancel() { this.currentAbort?.abort(); }
  async listPrograms(): Promise<ProgramCollection> { return this.store.load(); }
  async selectProgram(id: string): Promise<LearningProgram> {
    if (this.isPlanning()) throw new Error("Another program operation is in progress.");
    this.writing = true;
    try {
      const collection = await this.store.load();
      const selected = collection.programs.find(p => p.id === id);
      if (!selected) throw new Error("Unknown program ID. Run /programs to list saved plans.");
      collection.activeProgramId = id;
      await this.store.save(collection);
      return selected;
    } finally { this.writing = false; }
  }
  async getActiveProgram(): Promise<LearningProgram | null> {
    const collection = await this.store.load();
    return collection.programs.find(p => p.id === collection.activeProgramId) ?? null;
  }
  private updateActive(edit: (program: LearningProgram) => LearningProgram): Promise<LearningProgram> {
    if (this.planning) return Promise.reject(new Error("Curriculum generation is in progress."));
    // Serialize the read-modify-write operation, not only the underlying vault write.
    const operation = this.mutationTail.then(async () => {
      this.writing = true;
      try {
        const collection = await this.store.load();
        const index = collection.programs.findIndex(p => p.id === collection.activeProgramId);
        if (index === -1) throw new Error("No active learning program. Use /plan first.");
        const next = edit(structuredClone(collection.programs[index]));
        collection.programs[index] = next;
        await this.store.save(collection);
        return next;
      } finally { this.writing = false; }
    });
    this.mutationTail = operation.then(() => {}, () => {});
    return operation;
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
    const mastered = program.objectives.filter(o =>
      objectiveProgress(program, o.id, state.evidence).status === "mastered").length;
    const f = feasibility(program);
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
      `Mastered: ${mastered}/${program.objectives.length} objectives (requires independent delayed recall)`,
      `Plan: ~${f.estimatedMinutes} minutes including estimated review; available: ${f.availableMinutes ?? "unspecified"} minutes.`,
      `Feasibility: ${estimate}`,
      `Next: ${decision.kind} — ${decision.objective?.title ?? decision.reason}`,
      ...(decision.dueAt ? [`Review due: ${new Date(decision.dueAt).toLocaleString()}`] : []),
      `Session remaining: ${decision.minutesRemaining ?? program.constraints.minutesPerSession} minutes`,
    ].join("\n");
  }

  async createProgram(goal: string, requested: ProgramConstraints, operationId?: string): Promise<LearningProgram> {
    if (this.isPlanning()) throw new Error("Another learning program operation is in progress.");
    if (operationId) {
      const previous = (await this.store.load()).programs.find(p => p.creationOperationId === operationId);
      if (previous) return previous;
    }
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
        objectives: draft.objectives, createdAt: Date.now(), planVersion: 1,
        ...(operationId ? { creationOperationId: operationId } : {}),
      };
      const collection: ProgramCollection = await this.store.load();
      const previous = operationId && collection.programs.find(p => p.creationOperationId === operationId);
      if (previous) return previous;
      if (abort.signal.aborted) throw new Error("Curriculum generation cancelled before save.");
      collection.programs.push(program);
      collection.activeProgramId = program.id;
      await this.store.save(collection);
      return program;
    } finally { clearTimeout(timeout); this.planning = false; this.currentAbort = undefined; }
  }
}
