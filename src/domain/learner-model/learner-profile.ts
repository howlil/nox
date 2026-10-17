import type { LearningEvidence, LearningState } from "../learning-state/types";
import type { LearningProgram, LearningObjective } from "../learning-program/types";
import { objectiveProgress } from "../learning-program/rules";
import { criterionIdFor } from "./feedback-policy";
import { deriveGapStatus } from "../learning-state/gap-projection";

export type CriterionKnowledge = "unknown" | "needs-repair" | "assisted" | "provisional" | "verified";
export interface CriterionSnapshot {
  id: string;
  label: string;
  status: CriterionKnowledge;
  evidenceIds: string[];
}
export interface ObjectiveSnapshot {
  objectiveId: string;
  revision: number;
  status: "unseen" | "remediate" | "provisional" | "mastered";
  criterion: CriterionSnapshot[];
  recentEvidenceIds: string[];
  dueAt: number | null;
}
export interface LearnerProfile {
  version: 1;
  programId: string;
  planVersion: number;
  generatedAt: number;
  objectives: ObjectiveSnapshot[];
  evidenceCount: number;
  /** Bounded, citation-like source IDs, never narrative learner traits. */
  evidenceIds: string[];
}

const MAX_RECENT = 8;
function eligible(item: LearningEvidence, program: LearningProgram, objective: LearningObjective): boolean {
  const revision = objective.objectiveRevision ?? program.planVersion;
  return item.scope === "learner" && item.type === "practice" && item.programId === program.id &&
    item.objectiveId === objective.id && item.evidenceVersion === 3 &&
    item.objectiveRevision === revision && typeof item.questionId === "string" &&
    item.questionId.length > 0;
}

function independent(item: LearningEvidence): boolean {
  return item.assistance?.independent === true &&
    item.assistance.highestHintLevel === 0 && item.assisted !== true;
}

/** Derived read model. Never persists, appends, grades or assigns a personality label. */
export function deriveLearnerProfile(program: LearningProgram, state: LearningState,
  now: number): LearnerProfile {
  const objectives = program.objectives.filter(o => !o.deprecated).map(objective => {
    const revision = objective.objectiveRevision ?? program.planVersion;
    const history = state.evidence.filter(item => eligible(item, program, objective))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const progress = objectiveProgress(program, objective.id, state.evidence, now);
    const criterion: CriterionSnapshot[] = objective.rubric.map((label, index) => {
      const id = criterionIdFor(objective.id, revision, index);
      const observed = history.filter(item => item.rubricResults?.some(r => r.criterionId === id));
      const latest = observed.at(-1);
      const evidenceIds = observed.slice(-MAX_RECENT).map(item => item.id);
      if (!latest) return { id, label, status: "unknown" as const, evidenceIds };
      const result = latest.rubricResults?.find(r => r.criterionId === id);
      if (!result?.met || latest.outcome !== "correct") {
        return { id, label, status: "needs-repair" as const, evidenceIds };
      }
      if (!independent(latest) || latest.assessmentCoverage === "single-item") {
        return { id, label, status: "assisted" as const, evidenceIds };
      }
      const gap = state.gaps.find(g => g.programId === program.id &&
        g.objectiveId === objective.id && g.criterionId === id);
      const resolvedGap = gap ? deriveGapStatus(gap, history) === "resolved" : true;
      return { id, label,
        status: progress.status === "mastered" && resolvedGap ? "verified" as const :
          "provisional" as const, evidenceIds };
    });
    return {
      objectiveId: objective.id, revision, status: progress.status,
      criterion, dueAt: progress.dueAt ?? null,
      recentEvidenceIds: history.slice(-MAX_RECENT).map(item => item.id),
    };
  });
  const evidenceIds = [...new Set(objectives.flatMap(o => o.recentEvidenceIds))];
  return { version: 1, programId: program.id, planVersion: program.planVersion,
    generatedAt: now, objectives, evidenceCount: state.evidence.filter(e =>
      e.type === "practice" && e.scope === "learner" && e.programId === program.id).length,
    evidenceIds };
}

/** A compact prompt projection: authoritative labels and observed IDs only. */
export function toLearnerProfileContext(profile: LearnerProfile, objectiveId?: string) {
  const selected = objectiveId
    ? profile.objectives.filter(o => o.objectiveId === objectiveId)
    : profile.objectives;
  return { version: 1 as const, programId: profile.programId,
    planVersion: profile.planVersion,
    objectives: selected.slice(0, 16).map(o => ({
      objectiveId: o.objectiveId, revision: o.revision, status: o.status,
      criteria: o.criterion.slice(0, 12).map(c => ({
        id: c.id, status: c.status, evidenceIds: c.evidenceIds.slice(-4),
      })),
      recentEvidenceIds: o.recentEvidenceIds.slice(-4),
      dueAt: o.dueAt,
    })),
  };
}
