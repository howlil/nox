import type { LearningEvidence, LearningState } from "../learning-state/types";
import type { LearningDecision, LearningObjective, LearningProgram } from "../learning-program/types";
import { chooseFocusedActivity, chooseNextActivity } from "../learning-program/rules";
import { sessionRemainingMs } from "../learning-program/session-time";
import { decideFeedback, type FeedbackDecision } from "./feedback-policy";
import { deriveLearnerProfile, type ObjectiveSnapshot } from "./learner-profile";

const DAY = 86_400_000;
export type AdaptiveTrigger =
  | "focus-paused" | "focus-invalid" | "session-paused" | "session-ended"
  | "deadline-expired" | "legacy-compat" | "criterion-failed" | "scaffold"
  | "verify-independently" | "recall-due" | "recall-pending" | "transfer-required"
  | "assessment-needed" | "mastery-demonstrated" | "prerequisites-blocked"
  | "no-activity-due";

export interface AdaptiveActivityDecision extends LearningDecision {
  /** Explains a selection without giving the model authority to change it. */
  provenance?: {
    policy: "m4-v1";
    trigger: AdaptiveTrigger;
    objectiveRevision?: number;
    evidenceIds: string[];
    criterionIds: string[];
    scaffoldLevel?: 1 | 2 | 3 | 4;
  };
}

function evidenceFor(program: LearningProgram, objective: LearningObjective, state: LearningState): LearningEvidence[] {
  const revision = objective.objectiveRevision ?? program.planVersion;
  return state.evidence.filter(item => item.type === "practice" && item.scope === "learner" &&
    item.programId === program.id && item.objectiveId === objective.id &&
    item.evidenceVersion === 3 && item.objectiveRevision === revision &&
    typeof item.questionId === "string" && item.questionId.length > 0)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function decision(kind: LearningDecision["kind"], reason: string, trigger: AdaptiveTrigger,
  objective?: LearningObjective, history: readonly LearningEvidence[] = [],
  extras: { dueAt?: number; minutesRemaining?: number; criterionIds?: string[];
    scaffoldLevel?: 1 | 2 | 3 | 4; policyEvidenceIds?: string[];
    objectiveRevision?: number } = {}): AdaptiveActivityDecision {
  return {
    kind, reason, ...(objective ? { objective } : {}),
    ...(extras.dueAt !== undefined ? { dueAt: extras.dueAt } : {}),
    ...(extras.minutesRemaining !== undefined ? { minutesRemaining: extras.minutesRemaining } : {}),
    provenance: {
      policy: "m4-v1", trigger,
      ...(objective || extras.objectiveRevision !== undefined
        ? { objectiveRevision: extras.objectiveRevision ??
            objective?.objectiveRevision ?? 1 } : {}),
      evidenceIds: extras.policyEvidenceIds ?? history.slice(-4).map(item => item.id),
      criterionIds: extras.criterionIds ?? [],
      ...(extras.scaffoldLevel !== undefined ? { scaffoldLevel: extras.scaffoldLevel } : {}),
    },
  };
}

function newestFailureCriteria(profile: ObjectiveSnapshot, feedback?: FeedbackDecision): string[] {
  if (feedback && "failedCriterionIds" in feedback && feedback.failedCriterionIds.length) {
    return feedback.failedCriterionIds;
  }
  return profile.criterion.filter(criterion => criterion.status === "needs-repair" ||
    criterion.status === "unknown").map(criterion => criterion.id);
}

function forObjective(
  program: LearningProgram, objective: LearningObjective, profile: ObjectiveSnapshot,
  state: LearningState, now: number, minutesRemaining?: number, locked = false,
): AdaptiveActivityDecision {
  const history = evidenceFor(program, objective, state);
  const objectiveRevision = objective.objectiveRevision ?? program.planVersion;
  const latest = history.at(-1);
  if (!latest) {
    return decision("diagnostic", locked ? "Assess only the pinned focus objective." :
      "Assess this prerequisite-eligible objective before teaching.", "assessment-needed",
    objective, history, { minutesRemaining, objectiveRevision });
  }
  const feedback = decideFeedback(objective, history, latest);
  if (feedback.kind === "repair" || feedback.kind === "scaffold") {
    const criterionIds = newestFailureCriteria(profile, feedback);
    const taught = program.instructionEvents?.some(e => e.objectiveId === objective.id &&
      e.afterEvidenceAt === latest.createdAt) === true;
    const kind = latest.outcome === "correct" || taught || feedback.kind === "scaffold"
      ? "guided-practice" : "teach";
    return decision(kind,
      feedback.kind === "scaffold"
        ? "Repeated failures: guided, criterion-specific scaffolding before another independent check."
        : kind === "teach"
          ? "Teach the unverified criterion, then independently reassess."
          : "Practice only the incomplete criterion with bounded guidance.",
      feedback.kind === "scaffold" ? "scaffold" : "criterion-failed",
      objective, history, {
        minutesRemaining, criterionIds, objectiveRevision,
        ...(feedback.kind === "scaffold" ? { scaffoldLevel: feedback.level } : {}),
      });
  }
  if (feedback.kind === "independent-check") {
    return decision("guided-practice", "Assisted or single-item success needs an independent criterion check.",
      "verify-independently", objective, history,
      { minutesRemaining, objectiveRevision, criterionIds: profile.criterion.filter(c =>
        c.status !== "verified").map(c => c.id) });
  }
  if (feedback.kind === "delayed-recall") {
    return now >= feedback.dueAt
      ? decision("recall", "Independent delayed retrieval is due.", "recall-due",
        objective, history, { dueAt: feedback.dueAt, minutesRemaining, objectiveRevision })
      : decision("wait", "Independent recall is not due yet.", "recall-pending",
        undefined, history, { dueAt: feedback.dueAt, minutesRemaining, objectiveRevision });
  }
  if (feedback.kind === "transfer-check") {
    return decision("transfer", "Required transfer has not yet been demonstrated independently.",
      "transfer-required", objective, history, { minutesRemaining, objectiveRevision });
  }
  // Ready-to-advance comes from M1 complete-rubric + delayed independent recall.
  const dueAt = profile.dueAt ?? latest.createdAt + 3 * DAY;
  if (now >= dueAt) {
    return decision("recall", "Maintenance retrieval is due.", "recall-due",
      objective, history, { dueAt, minutesRemaining, objectiveRevision });
  }
  return decision("wait", locked
    ? "Pinned objective is ready. End focus or await maintenance recall."
    : "Objective is ready; other eligible objectives may proceed.",
  "mastery-demonstrated", undefined, history, { dueAt, minutesRemaining, objectiveRevision });
}

/** Pure M4 selector: program lock, M3 revision-scoped state, M1 feedback and explicit legacy compatibility. */
export function selectAdaptiveActivity(
  program: LearningProgram, state: LearningState, now: number,
): AdaptiveActivityDecision {
  const profile = deriveLearnerProfile(program, state, now);
  const active = program.objectives.filter(item => !item.deprecated);
  const byId = new Map(profile.objectives.map(item => [item.objectiveId, item]));
  const scopedModernEvidence = active.some(objective => evidenceFor(program, objective, state).length > 0);
  const anyLegacyEvidence = state.evidence.some(item => item.programId === program.id &&
    item.type === "practice" && item.scope === "learner" && item.evidenceVersion !== 3);

  // Existing v1/v2 sessions retain their original unversioned mastery semantics.
  // New M4 evidence is revision scoped; a mixed session never silently imports legacy mastery.
  if (!scopedModernEvidence && anyLegacyEvidence && program.planVersion === 1 &&
      active.every(objective => objective.objectiveRevision === undefined)) {
    const legacy = program.focus
      ? chooseFocusedActivity(program, state.evidence, now)
      : chooseNextActivity(program, state.evidence, now);
    return { ...legacy, provenance: { policy: "m4-v1", trigger: "legacy-compat",
      evidenceIds: [], criterionIds: [],
      ...(legacy.objective ? { objectiveRevision: 1 } : {}) } };
  }
  if (program.focus) {
    const focus = program.focus;
    if (focus.status !== "active") return decision("wait",
      "Objective focus is paused. Resume it from the owning chat.", "focus-paused");
    const objective = active.find(o => o.id === focus.objectiveId);
    if (!objective || focus.curriculumRevision !== program.planVersion ||
        focus.programId !== program.id) {
      return decision("wait", "Focus no longer matches the current curriculum.", "focus-invalid");
    }
    const stateForObjective = byId.get(objective.id);
    if (!stateForObjective) return decision("wait", "Focus has no current learner model.", "focus-invalid");
    // The pinned objective is never replaced by remediation, review or a higher-priority item.
    // A focus has NO session deadline or time budget.
    return forObjective(program, objective, stateForObjective, state, now, undefined, true);
  }
  if (program.constraints.deadline &&
      new Date(now).toLocaleDateString("en-CA") > program.constraints.deadline) {
    return decision("wait", "The program deadline passed. Replan before starting another timed session.",
      "deadline-expired");
  }
  const remainingMs = program.session ? sessionRemainingMs(program.session, now) :
    program.constraints.minutesPerSession * 60_000;
  const remaining = Math.ceil(remainingMs / 60_000);
  if (program.session && remainingMs === 0) return decision("timebox-ended",
    "Legacy session budget exhausted; all progress is retained.", "session-ended",
    undefined, [], { minutesRemaining: 0 });
  if (program.session?.timing?.pauseReasons.some(reason =>
    reason === "manual" || reason === "recovery" || reason === "app-inactive")) {
    return decision("wait", "Learning session paused. Use /resume-session.", "session-paused",
      undefined, [], { minutesRemaining: remaining });
  }

  const eligible = active.filter(objective => objective.prerequisiteIds.every(id =>
    byId.get(id)?.status === "mastered"));
  const priority = (objective: LearningObjective) =>
    objective.priority === "core" ? 0 : objective.priority === "supporting" ? 1 : 2;
  const order = new Map(program.objectives.map((objective, index) => [objective.id, index]));
  const sortPriority = (a: LearningObjective, b: LearningObjective) =>
    priority(a) - priority(b) || (order.get(a.id)! - order.get(b.id)!);

  const due = eligible.filter(objective => {
    const status = byId.get(objective.id);
    return status?.dueAt !== null && status?.dueAt !== undefined &&
      now >= status.dueAt &&
      (status.status === "mastered" || status.status === "provisional");
  }).sort((a, b) => (byId.get(a.id)!.dueAt! - byId.get(b.id)!.dueAt!) ||
    sortPriority(a, b));
  if (due[0]) {
    const selected = forObjective(program, due[0], byId.get(due[0].id)!, state, now, remaining);
    if (selected.kind === "recall") return selected;
  }

  const remediate = eligible.filter(objective =>
    byId.get(objective.id)?.status === "remediate").sort(sortPriority);
  if (remediate[0]) {
    return forObjective(program, remediate[0], byId.get(remediate[0].id)!, state, now, remaining);
  }

  const transfer = eligible.filter(objective => {
    const status = byId.get(objective.id);
    if (!status || status.status !== "provisional" || !objective.requiresTransfer) return false;
    const last = evidenceFor(program, objective, state).at(-1);
    return last && decideFeedback(objective, evidenceFor(program, objective, state), last).kind === "transfer-check";
  }).sort(sortPriority);
  if (transfer[0]) {
    return forObjective(program, transfer[0], byId.get(transfer[0].id)!, state, now, remaining);
  }

  const unseen = eligible.filter(objective => byId.get(objective.id)?.status === "unseen")
    .sort(sortPriority);
  if (unseen[0]) {
    return forObjective(program, unseen[0], byId.get(unseen[0].id)!, state, now, remaining);
  }

  const nextDue = eligible.map(objective => byId.get(objective.id)?.dueAt)
    .filter((dueAt): dueAt is number => dueAt !== null && dueAt !== undefined && dueAt > now)
    .sort((a, b) => a - b)[0];
  return decision("wait", eligible.length === 0 && active.length > 0
    ? "All remaining objectives have unmet prerequisites."
    : nextDue ? "No eligible action is due; next retrieval remains scheduled."
      : "No further eligible activities. Review completion or optional objectives.",
    eligible.length === 0 ? "prerequisites-blocked" : "no-activity-due",
    undefined, [], { dueAt: nextDue, minutesRemaining: remaining });
}
