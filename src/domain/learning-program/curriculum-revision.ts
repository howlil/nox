import type { LearningEvidence } from "../learning-state/types";
import { validateCurriculum } from "./rules";
import { isStructuralEvidence, isIndependentEvidence, hasCompleteRubric } from "../learner-model/evidence-eligibility";
import type { LearningObjective, LearningProgram, CurriculumRevision, StructuralGapReason } from "./types";
export type { CurriculumOperation, CurriculumRevision, AppliedCurriculumRevision, StructuralGapReason } from "./types";

export interface StructuralGap {
  reason: Exclude<StructuralGapReason, "goal-change">;
  objectiveId: string;
  evidenceIds: string[];
}

function unique(values: readonly string[]): boolean {
  return values.length === new Set(values).size;
}

/** Pure trigger detection. A model cannot define its own evidence or decide readiness. */
export function detectStructuralGap(program: LearningProgram, evidence: readonly LearningEvidence[]): StructuralGap | null {
  const consumed = new Set(program.curriculumRevisions?.flatMap(r => r.reasonEvidenceIds) ?? []);
  for (const objective of program.objectives) {
    if (objective.deprecated) continue;
    const attempts = evidence.filter(item => !consumed.has(item.id) &&
      isStructuralEvidence(program, objective, item))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const recent = attempts.slice(-3);
    if (recent.length === 3 &&
      new Set(recent.map(item => item.questionId)).size === 3 &&
      recent.every(item => item.outcome !== "correct" &&
        item.rubricResults?.some(result => !result.met))) {
      const failed = recent.flatMap(item => item.rubricResults!
        .filter(result => !result.met).map(result => result.criterionId!));
      if (new Set(failed).size >= 2) return { reason: "objective-too-broad",
        objectiveId: objective.id, evidenceIds: recent.map(item => item.id) };
      if (objective.prerequisiteIds.length) return { reason: "repeated-prerequisite-gap",
        objectiveId: objective.id, evidenceIds: recent.map(item => item.id) };
    }
    const diagnostic = attempts.filter(item => item.taskKind === "diagnostic" &&
      item.outcome === "correct" && isIndependentEvidence(item) &&
      hasCompleteRubric(objective, item));
    if (diagnostic.length >= 2 && diagnostic[0].questionId !== diagnostic[1].questionId) {
      return { reason: "unexpected-prior-mastery", objectiveId: objective.id,
        evidenceIds: diagnostic.slice(0, 2).map(item => item.id) };
    }
  }
  return null;
}

/** Application rechecks all invariants on approval; model suggestions are untrusted. */
export function applyCurriculumRevision(
  program: LearningProgram, revision: CurriculumRevision,
  evidence: readonly LearningEvidence[], appliedAt: number,
): LearningProgram {
  const existing = program.curriculumRevisions?.find(r => r.operationId === revision.operationId);
  if (existing) return structuredClone(program); // durable idempotent acknowledgment
  if (revision.programId !== program.id || revision.baseVersion !== program.planVersion) {
    throw new Error("Curriculum version conflict: the program changed after preview.");
  }
  if (program.focus) throw new Error("End the existing objective focus before applying a structural revision.");
  if (program.session) throw new Error("End the timed study session before changing the curriculum.");
  if (!revision.id.trim() || !revision.operationId.trim() || revision.operations.length === 0 ||
      revision.operations.length > 30 || !unique(revision.reasonEvidenceIds) ||
      !Number.isFinite(appliedAt) || appliedAt < 0) {
    throw new Error("Invalid curriculum revision metadata.");
  }
  const allowedReasons: StructuralGapReason[] = [
    "repeated-prerequisite-gap", "objective-too-broad", "unexpected-prior-mastery", "goal-change",
  ];
  if (!allowedReasons.includes(revision.reason)) throw new Error("Unknown structural trigger.");
  const valid = new Set(evidence.filter(item => {
    const objective = program.objectives.find(o => o.id === item.objectiveId && !o.deprecated);
    return objective && isStructuralEvidence(program, objective, item);
  }).map(item => item.id));
  if (revision.reason !== "goal-change" && revision.reasonEvidenceIds.length === 0) {
    throw new Error("Evidence is required for an automatic structural revision.");
  }
  if (revision.reasonEvidenceIds.some(id => !valid.has(id))) {
    throw new Error("Structural revision referenced unknown or out-of-program evidence.");
  }
  const nextVersion = program.planVersion + 1;
  const undo = revision.operations.find(op => op.kind === "revert");
  let objectives: LearningObjective[];
  if (undo?.kind === "revert") {
    if (revision.operations.length !== 1 || revision.reason !== "goal-change" ||
        revision.reasonEvidenceIds.length) throw new Error("Revert must be a single explicit operation.");
    const last = program.curriculumRevisions?.at(-1);
    if (!last?.beforeSnapshot?.length || last.operationId !== undo.targetOperationId) {
      throw new Error("Only the latest revision with a durable snapshot can be reverted.");
    }
    const previous = new Map(last.beforeSnapshot.map(objective => [objective.id, objective]));
    const current = new Map(program.objectives.map(objective => [objective.id, objective]));
    objectives = last.beforeSnapshot.map(prior => {
      const now = current.get(prior.id);
      if (!now) throw new Error("Historical objective disappeared during revert.");
      const old = { ...prior, objectiveRevision: 0 };
      const fresh = { ...now, objectiveRevision: 0 };
      return JSON.stringify(old) === JSON.stringify(fresh) ? structuredClone(now)
        : { ...structuredClone(prior), objectiveRevision: nextVersion };
    });
    for (const currentObjective of program.objectives) {
      if (!previous.has(currentObjective.id)) {
        objectives.push({ ...structuredClone(currentObjective), deprecated: true,
          replacementIds: [], objectiveRevision: nextVersion });
      }
    }
  } else {
    objectives = program.objectives.map(o => ({
      ...structuredClone(o), objectiveRevision: o.objectiveRevision ?? program.planVersion,
    }));
  }
  const touched = new Set<string>();
  if (!undo) for (const operation of revision.operations) {
    if (operation.kind === "revert") throw new Error("Cannot mix revert with edits.");
    const id = operation.kind === "add" ? operation.objective.id : operation.objectiveId;
    if (touched.has(id)) throw new Error("Duplicate curriculum operation for objective: " + id);
    touched.add(id);
    const target = objectives.find(o => o.id === id);
    if (operation.kind === "add") {
      if (target) throw new Error("Curriculum add conflicts with an existing objective.");
      objectives.push({ ...structuredClone(operation.objective),
        objectiveRevision: nextVersion, deprecated: false, replacementIds: undefined });
      continue;
    }
    if (!target) throw new Error("Structural revision referenced unknown objective: " + id);
    if (target.deprecated) throw new Error("Cannot revise an already deprecated objective.");
    if (operation.kind === "revise") {
      const changes = operation.changes;
      if (!changes || Object.keys(changes).length === 0) throw new Error("Empty objective revision.");
      const allowed = ["title", "outcome", "estimatedMinutes", "rubric", "sourceRefs", "priority", "requiresTransfer"];
      if (Object.keys(changes).some(key => !allowed.includes(key))) {
        throw new Error("Forbidden field in objective revision.");
      }
      Object.assign(target, structuredClone(changes), { objectiveRevision: nextVersion });
    } else if (operation.kind === "change-prerequisites") {
      target.prerequisiteIds = [...operation.prerequisiteIds];
      target.objectiveRevision = nextVersion;
    } else {
      target.deprecated = true;
      target.replacementIds = [...operation.replacementIds];
      target.objectiveRevision = nextVersion;
    }
  }
  // The normal validator rejects unsupported source paths, exclusion violations,
  // non-existent dependencies, duplicate IDs and cycles.
  const validated = validateCurriculum({ kind: "curriculum", objectives }, program.constraints).objectives;
  const all = new Map(validated.map(o => [o.id, o]));
  for (const objective of validated) {
    if (objective.deprecated) continue;
    if (objective.prerequisiteIds.some(id => all.get(id)?.deprecated)) {
      throw new Error("Active objectives cannot depend on deprecated prerequisites.");
    }
  }
  for (const objective of validated) {
    if (!objective.deprecated) continue;
    const replacements = objective.replacementIds ?? [];
    if (!unique(replacements) || replacements.some(id => id === objective.id ||
        !all.has(id) || all.get(id)?.deprecated)) {
      throw new Error("Deprecation replacements must be distinct active objectives.");
    }
  }
  return { ...structuredClone(program), version: 2, objectives: validated, planVersion: nextVersion,
    curriculumRevisions: [...(program.curriculumRevisions ?? []), {
      ...structuredClone(revision), toVersion: nextVersion, appliedAt,
      beforeSnapshot: structuredClone(program.objectives),
      afterSnapshot: structuredClone(validated),
    }] };
}
