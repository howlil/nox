import type { AgentRuntimePort } from "../agent/AgentRuntime";
import type { ContextPort, LearningStatePort, ProgramStorePort } from "./ports";
import type { LearningProgram, ProgramCollection, ProgramConstraints, LearningDecision } from "../domain/learning-program/types";
import { chooseNextActivity, feasibility, validateConstraints, validateCurriculum } from "../domain/learning-program/rules";

/** Program planning and session selection. The model generates content, never transitions. */
export class LearningProgramOrchestrator {
  private planning = false;
  private writing = false;
  private currentAbort?: AbortController;
  constructor(private readonly runtime: AgentRuntimePort, private readonly contexts: ContextPort,
    private readonly learningState: LearningStatePort, private readonly store: ProgramStorePort,
    private readonly currentModel: () => string | undefined) {}

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
  private async updateActive(edit: (program: LearningProgram) => LearningProgram): Promise<LearningProgram> {
    if (this.isPlanning()) throw new Error("Another program operation is in progress.");
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
  }
  async startSession(): Promise<LearningProgram> {
    return this.updateActive(program => ({ ...program,
      session: { startedAt: Date.now(), timeBudgetMinutes: program.constraints.minutesPerSession } }));
  }
  async endSession(): Promise<LearningProgram> {
    return this.updateActive(program => ({ ...program, session: undefined }));
  }
  async getDecision(): Promise<{ program: LearningProgram; decision: LearningDecision } | null> {
    const program = await this.getActiveProgram();
    if (!program) return null;
    const state = await this.learningState.load();
    return { program, decision: chooseNextActivity(program, state.evidence) };
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
    const estimate = f.feasible === null ? "No deadline set" :
      f.feasible ? "Within estimated time budget" :
      "At risk: estimated work exceeds available time. Reduce scope or adjust deadline/time budget.";
    return [
      `Program: ${program.goal}`,
      `Mastered: ${mastered}/${program.objectives.length} objectives (requires independent delayed recall)`,
      `Plan: ~${f.estimatedMinutes} minutes including estimated review; available: ${f.availableMinutes ?? "unspecified"} minutes.`,
      `Feasibility: ${estimate}`,
      `Next: ${decision.kind} — ${decision.objective?.title ?? decision.reason}`,
      ...(decision.dueAt ? [`Review due: ${new Date(decision.dueAt).toLocaleString()}`] : []),
      `Session remaining: ${decision.minutesRemaining ?? program.constraints.minutesPerSession} minutes`,
    ].join("\n");
  }

  async createProgram(goal: string, requested: ProgramConstraints): Promise<LearningProgram> {
    if (this.isPlanning()) throw new Error("Another learning program operation is in progress.");
    this.planning = true;
    const abort = this.currentAbort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 120_000);
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
      };
      const collection: ProgramCollection = await this.store.load();
      collection.programs.push(program);
      collection.activeProgramId = program.id;
      await this.store.save(collection);
      return program;
    } finally { clearTimeout(timeout); this.planning = false; this.currentAbort = undefined; }
  }
}
