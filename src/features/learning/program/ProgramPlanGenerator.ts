import type { AgentRuntimePort } from "../../../types";
import type { ContextPort } from "../../../application/ports";
import type { LearningProgram, ProgramConstraints } from "../../../domain/learning-program/types";
import { validateConstraints, validateCurriculum } from "../../../domain/learning-program/rules";

/** Provider-backed curriculum proposal only.
 * This capability can create a validated preview, never persist or activate it.
 * Request cancellation and preview lifetime remain owned by the orchestrator.
 */
export class ProgramPlanGenerator {
  constructor(
    private readonly runtime: AgentRuntimePort,
    private readonly contexts: ContextPort,
    private readonly model: () => string | undefined,
    private readonly now: () => number,
  ) {}

  async generate(goal: string, requested: ProgramConstraints, signal: AbortSignal): Promise<LearningProgram> {
      const constraints: ProgramConstraints = structuredClone(requested);
      // General plans must not inspect or include arbitrary active note content.
      // This is enforced at the last input construction point, not only by the UI.
      let source: { file: string; content: string } | undefined;
      if (constraints.sourceBound) {
        // Reject unsupported providers before reading any private vault contents.
        if (!this.runtime.supportsSourceIsolation?.()) {
          throw new Error("A source-limited curriculum requires an isolated provider with no vault filesystem tools.");
        }
        const context = await this.contexts.resolve();
        source = context.selection ?? (context.activeNote ? {
          file: context.activeNote.path, content: context.activeNote.content,
        } : undefined);
        if (!source) throw new Error("Open or select a source note before using sources=active.");
        if (constraints.sourcePaths.length > 0 && !constraints.sourcePaths.includes(source.file)) {
          throw new Error("Source note changed during onboarding. Reopen the approved note and retry.");
        }
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
        { model: this.model() }, signal);
      for await (const event of messages) {
        if (signal.aborted) throw new Error("Curriculum generation timed out.");
        if (event.type === "failed") throw new Error(event.failure.message);
        if (event.type === "cancelled") throw new Error("Curriculum generation cancelled.");
        if (event.type === "text") {
          output += event.content;
          if (output.length > 250_000) throw new Error("Curriculum response exceeded safety limit.");
        }
        if (event.type === "completed") { completed = true; break; }
      }
      if (signal.aborted) throw new Error("Curriculum generation cancelled or timed out.");
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
      if (signal.aborted) throw new Error("Curriculum generation cancelled before preview.");
      return structuredClone(program);
  }
}
