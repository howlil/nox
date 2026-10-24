import type { LearningProgram } from "../learning-program/types";
import type { LearningState } from "../learning-state/types";
import type { CurriculumRevisionPreview } from "../learning-program/curriculum-preview";
import { deriveLearnerProfile } from "./learner-profile";
import { selectAdaptiveActivity } from "./activity-policy";

type SessionClock = {
  budgetMs: number; activeMs: number; remainingMs: number; aiWaitingMs: number;
  status: "active" | "waiting-ai" | "paused" | "recovered" | "exhausted";
};

/** Pure projection over authoritative program/evidence snapshots. */
export function projectLearningOverview(
  program: LearningProgram, learning: LearningState, now: number,
  revisionPreview?: CurriculumRevisionPreview, sessionTime?: SessionClock | null,
) {
    const profile = deriveLearnerProfile(program, learning, now);
    const next = selectAdaptiveActivity(program, learning, now, profile);
    const byObjective = new Map(profile.objectives.map(item => [item.objectiveId, item]));
    const attemptCounts = new Map<string, number>();
    const objectiveRevisions = new Map(program.objectives
      .filter(objective => !objective.deprecated)
      .map(objective => [objective.id, objective.objectiveRevision ?? program.planVersion] as const));
    for (const evidence of learning.evidence) {
      if (evidence.type !== "practice" || evidence.scope !== "learner" ||
          evidence.programId !== program.id || evidence.evidenceVersion !== 3 ||
          !evidence.objectiveId ||
          objectiveRevisions.get(evidence.objectiveId) !== evidence.objectiveRevision) continue;
      attemptCounts.set(evidence.objectiveId, (attemptCounts.get(evidence.objectiveId) ?? 0) + 1);
    }
    return {
      goal: program.goal,
      planVersion: program.planVersion,
      ...(revisionPreview ? { revisionPreview } : {}),
      active: Boolean(program.session || program.focus?.status === "active"),
      focus: program.focus ? { status: program.focus.status,
        objectiveId: program.focus.objectiveId } : undefined,
      ...(program.session && sessionTime ? { sessionTime } : {}),
      next: { kind: next.kind, objectiveId: next.objective?.id,
        reason: next.reason, dueAt: next.dueAt,
        trigger: next.provenance?.trigger,
        criterionIds: next.provenance?.criterionIds,
        scaffoldLevel: next.provenance?.scaffoldLevel },
      objectives: program.objectives.filter(objective => !objective.deprecated).map(objective => {
        const projected = byObjective.get(objective.id);
        return { objective, status: projected?.status ?? "unseen", attempts: attemptCounts.get(objective.id) ?? 0,
          dueAt: projected?.dueAt ?? null,
          criteria: projected?.criterion ?? [] };
      }),
    };
}
