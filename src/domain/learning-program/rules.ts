import type { LearningEvidence } from "../learning-state/types";
import { decideFeedback } from "../learner-model/feedback-policy";
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
    };
  });
  const byId = new Map(objectives.map(o => [o.id, o]));
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
    .filter(item => item.priority !== "optional")
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

function objectiveEvidence(program: LearningProgram, objectiveId: string, evidence: LearningEvidence[]) {
  return evidence
    .filter(item => item.scope === "learner" && item.type === "practice" &&
      item.programId === program.id && item.objectiveId === objectiveId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function objectiveProgress(program: LearningProgram, objectiveId: string,
  evidence: LearningEvidence[], now = Date.now()) {
  const attempts = objectiveEvidence(program, objectiveId, evidence);
  if (!attempts.length) return { status: "unseen" as const, dueAt: null, attempts: 0 };
  const last = attempts[attempts.length - 1];
  const objective = program.objectives.find(item => item.id === objectiveId);
  const rubric = objective?.rubric ?? [];
  const independentAnswer = (item: LearningEvidence): boolean =>
    !item.assisted && item.assistance?.independent !== false &&
      (item.assistance?.highestHintLevel ?? 0) === 0;
  const complete = (item: LearningEvidence): boolean =>
    rubric.length > 0 && rubric.every((criterion, index) =>
      item.rubricResults?.some(result => {
        if (!result.met) return false;
        const stableId = objective?.criteria?.[index]?.id;
        // Rewording may preserve a stable criterion ID; changing its meaning
        // must allocate a new ID. Legacy unversioned evidence is text-bound.
        if (item.objectiveRevision !== undefined) {
          return Boolean(stableId && result.criterionId === stableId &&
            item.objectiveRevision >= 1 && item.objectiveRevision <= program.planVersion);
        }
        return result.criterion === criterion;
      }));
  if (last.outcome !== "correct" || !independentAnswer(last) || last.assessmentCoverage === "single-item" ||
      last.createdAt <= 0 || !complete(last)) {
    return { status: "remediate" as const, dueAt: null, attempts: attempts.length };
  }
  const correct = attempts.filter(item => item.outcome === "correct" && independentAnswer(item) &&
    item.assessmentCoverage !== "single-item" && item.createdAt > 0 && complete(item));
  // Repetition is not retention: only genuine delayed recall after earlier
  // independent criterion-complete practice qualifies for mastery.
  const independent = correct.some(first => first.taskKind !== "recall" &&
    correct.some(recall => recall.taskKind === "recall" &&
      recall.createdAt - first.createdAt >= 12 * 3_600_000));
  const dueAt = last.createdAt + (independent ? 3 : 1) * DAY;
  return { status: independent ? "mastered" as const : "provisional" as const,
    dueAt, attempts: attempts.length, due: now >= dueAt };
}

/** A pinned objective is not released by a deadline, session timer, or another due topic. */
export function chooseFocusedActivity(program: LearningProgram, evidence: LearningEvidence[],
  now = Date.now()): LearningDecision {
  const focus = program.focus;
  if (!focus) throw new Error("No objective focus.");
  if (focus.status === "paused") {
    return { kind: "wait", reason: "Objective focus paused. Use /resume-focus." };
  }
  const objective = program.objectives.find(item => item.id === focus.objectiveId);
  if (!objective || focus.curriculumRevision !== program.planVersion) {
    throw new Error("Focused objective is stale.");
  }
  const progress = objectiveProgress(program, objective.id, evidence, now);
  if (progress.status === "unseen") {
    return { kind: "diagnostic", objective, reason: "Assess the pinned objective." };
  }
  if (progress.status === "remediate") {
    const attempts = objectiveEvidence(program, objective.id, evidence);
    const last = attempts[attempts.length - 1];
    const taught = program.instructionEvents?.some(item =>
      item.objectiveId === objective.id && item.afterEvidenceAt === last.createdAt);
    const feedback = decideFeedback(objective, attempts, last);
    const kind: LearningDecision["kind"] = feedback.kind === "repair" ? "remediate" :
      feedback.kind === "scaffold" && !taught ? "teach" : "guided-practice";
    return { kind, objective,
      targetCriterionIds: feedback.failedCriteria,
      sourceEvidenceIds: feedback.evidenceIds,
      ...(feedback.kind === "scaffold" ? { scaffoldLevel: feedback.level } : {}),
      reason: kind === "remediate"
        ? "Explain the correction to the failed criterion in your own words."
        : kind === "teach" ? "Repeated errors call for a limited targeted scaffold."
          : "Verify an independent variation without the earlier hint." };
  }
  if (progress.dueAt !== null && now >= progress.dueAt) {
    return { kind: "recall", objective, reason: "Delayed retrieval is due.", dueAt: progress.dueAt };
  }
  if (progress.status === "mastered" &&
      !objectiveEvidence(program, objective.id, evidence).some(item =>
        item.taskKind === "transfer" && item.outcome === "correct" && !item.assisted)) {
    return { kind: "transfer", objective, reason: "Verify transfer on the pinned objective." };
  }
  if (progress.status === "provisional") {
    return { kind: "guided-practice", objective, reason: "Practice independently before delayed recall." };
  }
  return { kind: "wait", objective, reason: "Objective checks complete. Use /end-focus to switch.",
    dueAt: progress.dueAt ?? undefined };
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
  const states = new Map(program.objectives.map(item =>
    [item.id, objectiveProgress(program, item.id, evidence, now)] as const));
  const candidates = program.objectives.filter(item => item.prerequisiteIds.every(id =>
    states.get(id)?.status === "mastered"));
  const overdue = candidates.filter(item => {
    const state = states.get(item.id);
    return (state?.status === "mastered" || state?.status === "provisional") &&
      state.dueAt !== null && now >= state.dueAt;
  }).sort((a, b) => (states.get(a.id)?.dueAt ?? 0) - (states.get(b.id)?.dueAt ?? 0));
  if (overdue[0]) return { kind: "recall", objective: overdue[0], reason: "Scheduled delayed retrieval is due.",
    dueAt: states.get(overdue[0].id)?.dueAt ?? undefined, minutesRemaining: remaining };
  const remediation = candidates.find(item => states.get(item.id)?.status === "remediate");
  if (remediation) {
    const attempts = objectiveEvidence(program, remediation.id, evidence);
    const last = attempts[attempts.length - 1];
    const taught = program.instructionEvents?.some(item =>
      item.objectiveId === remediation.id && item.afterEvidenceAt === last.createdAt);
    const kind = last.outcome === "correct" && (last.assisted || last.assessmentCoverage === "single-item") ? "guided-practice" :
      taught ? "guided-practice" : "teach";
    return { kind, objective: remediation,
      reason: kind === "teach" ? "Teach the missed concept before retrying." :
        "Guided practice should target the most recent failed criterion.",
      minutesRemaining: remaining };
  }
  const transfer = candidates.find(item => states.get(item.id)?.status === "mastered" &&
    !objectiveEvidence(program, item.id, evidence).some(attempt => attempt.taskKind === "transfer"));
  if (transfer) return { kind: "transfer", objective: transfer,
    reason: "Check whether knowledge transfers to a new situation.", minutesRemaining: remaining };
  const eligible = candidates.find(item => states.get(item.id)?.status === "unseen" && item.priority !== "optional") ??
    candidates.find(item => states.get(item.id)?.status === "unseen");
  if (eligible) return { kind: "diagnostic", objective: eligible,
    reason: "Prerequisites are satisfied; assess this objective before teaching.", minutesRemaining: remaining };
  const pending = [...states.values()].filter(state => state.dueAt !== null)
    .map(state => state.dueAt as number).sort((a, b) => a - b);
  return { kind: "wait", reason: pending.length ? "No eligible activity is due. Next review is scheduled." :
    "Prerequisites are not yet mastered or the program is complete.", dueAt: pending[0],
    minutesRemaining: remaining };
}
