import type { LearningEvidence } from "../learning-state/types";
import { validateCurriculum } from "./rules";
import type { LearningObjective, LearningProgram } from "./types";

export type StructuralGapReason =
  | "repeated-prerequisite-gap" | "objective-too-broad"
  | "unexpected-prior-mastery" | "goal-change";

export type CurriculumOperation =
  | { kind: "add"; objective: LearningObjective }
  | { kind: "revise"; objectiveId: string; changes: Partial<Omit<LearningObjective,
      "id" | "prerequisiteIds" | "objectiveRevision" | "deprecated" | "replacementIds">> }
  | { kind: "change-prerequisites"; objectiveId: string; prerequisiteIds: string[] }
  | { kind: "deprecate"; objectiveId: string; replacementIds: string[] };

export interface CurriculumRevision {
  id: string;
  programId: string;
  baseVersion: number;
  operationId: string;
  reason: StructuralGapReason;
  reasonEvidenceIds: string[];
  operations: CurriculumOperation[];
}

export interface AppliedCurriculumRevision extends CurriculumRevision {
  toVersion: number;
  appliedAt: number;
}

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
  const entries = evidence.filter(item => !consumed.has(item.id) &&
    item.scope === "learner" &&
    item.type === "practice" && item.programId === program.id &&
    program.objectives.some(o => o.id === item.objectiveId && !o.deprecated) &&
    (item.objectiveRevision === undefined || item.objectiveRevision ===
      (program.objectives.find(o => o.id === item.objectiveId)?.objectiveRevision ?? program.planVersion)))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const objective of program.objectives) {
    if (objective.deprecated) continue;
    const attempts = entries.filter(e => e.objectiveId === objective.id);
    const recent = attempts.slice(-3);
    if (recent.length >= 3 && recent.every(e => e.outcome !== "correct")) {
      const failed = recent.flatMap(e => e.rubricResults?.filter(r => !r.met)
        .map(r => r.criterionId ?? r.criterion) ?? []);
      if (new Set(failed).size >= 2) return { reason: "objective-too-broad", objectiveId: objective.id,
        evidenceIds: recent.map(e => e.id) };
      if (objective.prerequisiteIds.length > 0) return { reason: "repeated-prerequisite-gap",
        objectiveId: objective.id, evidenceIds: recent.map(e => e.id) };
    }
    if (attempts.length >= 2 && attempts.slice(0, 2).every(e =>
      e.outcome === "correct" && !e.assisted &&
      e.assistance?.independent !== false &&
      e.rubricResults?.every(r => r.met) === true)) {
      return { reason: "unexpected-prior-mastery",
        objectiveId: objective.id, evidenceIds: attempts.slice(0, 2).map(e => e.id) };
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
  const valid = new Set(evidence.filter(e => e.scope === "learner" &&
    e.programId === program.id).map(e => e.id));
  if (revision.reason !== "goal-change" && revision.reasonEvidenceIds.length === 0) {
    throw new Error("Evidence is required for an automatic structural revision.");
  }
  if (revision.reasonEvidenceIds.some(id => !valid.has(id))) {
    throw new Error("Structural revision referenced unknown or out-of-program evidence.");
  }
  const nextVersion = program.planVersion + 1;
  const objectives = program.objectives.map(o => ({
    ...structuredClone(o), objectiveRevision: o.objectiveRevision ?? program.planVersion,
  }));
  const touched = new Set<string>();
  for (const operation of revision.operations) {
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
    }] };
}
