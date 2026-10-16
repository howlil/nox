import type { LearningEvidence } from "../learning-state/types";
import { decideFocusedLearningActivity, decideLearningActivity,
  nextEligibleRecallAt, selectEligibleObjective } from "./activity-policy";
import { sessionRemainingMs } from "./session-time";
import type { CurriculumDraft, LearningDecision, LearningObjective, LearningProgram, ProgramConstraints } from "./types";

const DAY = 86_400_000;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);
const MAX_OBJECTIVES = 60;
// Constraints and evaluation criteria remain application-enforced.

export function validateConstraints(constraints: ProgramConstraints, today = new Date()): void {
  if (constraints.startingLevel !== undefined &&
    !["beginner", "intermediate", "advanced"].includes(constraints.startingLevel)) {
    throw new Error("Invalid self-reported starting level.");
  }
  if (!Number.isInteger(constraints.minutesPerSession) || constraints.minutesPerSession < 10 || constraints.minutesPerSession > 240) {
    throw new Error("Minutes per session must be 10–240.");
  }
  if (!Number.isInteger(constraints.sessionsPerWeek) || constraints.sessionsPerWeek < 1 || constraints.sessionsPerWeek > 7) {
    throw new Error("Sessions per week must be 1–7.");
  }
  if (constraints.deadline) {
    const iso = constraints.deadline;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const deadline = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59) : null;
    if (!match || !deadline ||
        deadline.getFullYear() !== Number(match[1]) ||
        deadline.getMonth() !== Number(match[2]) - 1 ||
        deadline.getDate() !== Number(match[3]) ||
        deadline.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) {
      throw new Error("Deadline must be a valid present or future date (YYYY-MM-DD).");
    }
  }
  if (constraints.sourceBound && constraints.sourcePaths.length === 0) {
    throw new Error("Source-bound programs require at least one selected note.");
  }
}

export function validateCurriculum(value: unknown, constraints: ProgramConstraints): CurriculumDraft {
  if (!value || typeof value !== "object") throw new Error("Invalid curriculum response.");
  const draft = value as Record<string, unknown>;
  if (draft.kind !== "curriculum" || !Array.isArray(draft.objectives) ||
      draft.objectives.length < 1 || draft.objectives.length > MAX_OBJECTIVES) {
    throw new Error("Curriculum requires 1–60 objectives.");
  }
  const seen = new Set<string>();
  const objectives: LearningObjective[] = draft.objectives.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Malformed learning objective.");
    const o = item as Record<string, unknown>;
    if (!isText(o.id) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(o.id) || seen.has(o.id)) {
      throw new Error("Objective IDs must be unique, stable ASCII identifiers.");
    }
    seen.add(o.id);
    if (!isText(o.title) || !isText(o.outcome) || !Number.isInteger(o.estimatedMinutes) ||
        (o.estimatedMinutes as number) < 5 || (o.estimatedMinutes as number) > 1200 ||
        !isStringList(o.prerequisiteIds) || !isStringList(o.rubric) || o.rubric.length < 1 || new Set(o.rubric).size !== o.rubric.length ||
        !isStringList(o.sourceRefs) ||
        (o.deprecated !== undefined && typeof o.deprecated !== "boolean") ||
        !["core", "supporting", "optional"].includes(String(o.priority))) {
      throw new Error(`Invalid objective contract: ${o.id}`);
    }
    const rubric = o.rubric as string[];
    // Assign IDs once for new drafts; persisted IDs remain fixed across wording edits.
    const criteria = o.criteria === undefined
      ? rubric.map((description, index) => ({ id: "c" + (index + 1), description, required: true }))
      : o.criteria;
    if (!Array.isArray(criteria) || criteria.length !== rubric.length ||
        new Set(criteria.map((entry: unknown) =>
          entry && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined)).size !== rubric.length ||
        !criteria.every((entry: unknown, index: number) => {
          if (!entry || typeof entry !== "object") return false;
          const item = entry as Record<string, unknown>;
          return typeof item.id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(item.id) &&
            item.description === rubric[index] && typeof item.required === "boolean";
        })) {
      throw new Error("Invalid stable criterion identities for objective " + o.id);
    }
    const titleAndOutcome = String(o.title) + " " + String(o.outcome) + " " + rubric.join(" ");
    for (const topic of constraints.excludedTopics) {
      if (titleAndOutcome.toLowerCase().includes(topic.toLowerCase())) {
        throw new Error("Objective includes excluded topic: " + topic);
      }
    }
    const sourceRefs = o.sourceRefs as string[];
    if (constraints.sourceBound && (sourceRefs.length === 0 ||
        sourceRefs.some(ref => !constraints.sourcePaths.includes(ref)))) {
      throw new Error(`Objective ${o.id} references unapproved or missing source material.`);
    }
    return {
      id: o.id, title: o.title, outcome: o.outcome,
      prerequisiteIds: [...new Set(o.prerequisiteIds as string[])],
      estimatedMinutes: o.estimatedMinutes as number,
      rubric: [...rubric],
      criteria: criteria.map((entry: { id: string; description: string; required: boolean }) => ({ ...entry })),
      sourceRefs, priority: o.priority as LearningObjective["priority"],
      ...(o.deprecated === true ? { deprecated: true } : {}),
    };
  });
  const byId = new Map(objectives.map(o => [o.id, o]));
  for (const objective of objectives) {
    if (!objective.deprecated && objective.prerequisiteIds.some(id => byId.get(id)?.deprecated)) {
      throw new Error("Active objectives cannot depend on deprecated prerequisites.");
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error(`Curriculum prerequisite cycle at ${id}.`);
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node) throw new Error(`Unknown prerequisite: ${id}`);
    visiting.add(id);
    for (const prerequisite of node.prerequisiteIds) {
      if (prerequisite === id) throw new Error("An objective cannot depend on itself.");
      visit(prerequisite);
    }
    visiting.delete(id); visited.add(id);
  }
  for (const item of objectives) visit(item.id);
  return { kind: "curriculum", objectives };
}

export function feasibility(program: LearningProgram, now = Date.now()) {
  const requiredMinutes = program.objectives
    .filter(item => !item.deprecated && item.priority !== "optional")
    .reduce((sum, item) => sum + item.estimatedMinutes, 0);
  // Reserve review + formative assessment capacity; an estimate, not a promise.
  const estimatedMinutes = Math.ceil(requiredMinutes * 1.4);
  if (!program.constraints.deadline) return { estimatedMinutes, availableMinutes: null, feasible: null };
  const deadline = new Date(`${program.constraints.deadline}T23:59:59`).getTime();
  const weeksRemaining = Math.max(0, (deadline - now) / (7 * DAY));
  const availableMinutes = Math.floor(weeksRemaining * program.constraints.sessionsPerWeek *
    program.constraints.minutesPerSession);
  return { estimatedMinutes, availableMinutes, feasible: estimatedMinutes <= availableMinutes };
}

// Historical callers keep this stable export; the pure policy owns implementation.
export { objectiveProgress } from "./objective-readiness";

/** Focus always pins the requested objective; pure policy prevents topic hopping. */
export function chooseFocusedActivity(program: LearningProgram, evidence: LearningEvidence[],
  now = Date.now()): LearningDecision {
  return decideFocusedLearningActivity(program, evidence, now);
}

/** Legacy timed sessions remain supported; objective focus is self-paced. */
export function chooseNextActivity(program: LearningProgram, evidence: LearningEvidence[],
  now = Date.now()): LearningDecision {
  if (program.focus) return chooseFocusedActivity(program, evidence, now);
  if (program.constraints.deadline &&
      new Date(now).toLocaleDateString("en-CA") > program.constraints.deadline) {
    return { kind: "wait", reason: "The program deadline has passed. Replan or create a new program before continuing." };
  }
  const remainingMs = program.session ? sessionRemainingMs(program.session, now) :
    program.constraints.minutesPerSession * 60_000;
  const remaining = Math.ceil(remainingMs / 60_000);
  if (program.session && remainingMs === 0) {
    return { kind: "timebox-ended", reason: "Session time budget is exhausted; progress is preserved.", minutesRemaining: 0 };
  }
  if (program.session?.timing?.pauseReasons.some(reason => reason === "manual" || reason === "recovery" || reason === "app-inactive")) {
    return { kind: "wait", reason: "Learning session is paused. Use /resume-session to continue.", minutesRemaining: remaining };
  }
  const selected = selectEligibleObjective(program, evidence, now);
  if (selected) {
    return { ...decideLearningActivity(program, selected, evidence, now), minutesRemaining: remaining };
  }
  const dueAt = nextEligibleRecallAt(program, evidence, now);
  return {
    kind: "wait", reason: dueAt !== undefined
      ? "No eligible activity is due. Next review is scheduled."
      : "Prerequisites are not yet mastered or the program is complete.",
    dueAt, minutesRemaining: remaining,
  };
}
