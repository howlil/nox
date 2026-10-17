import type { CurriculumRevisionRecord, LearningObjective, LearningProgram } from "./types";
import { validateCurriculum } from "./rules";

export type StructuralRevisionAction =
  | { kind: "revise"; objectiveId: string;
      changes: Partial<Pick<LearningObjective, "title" | "outcome" | "estimatedMinutes" | "priority">> }
  | { kind: "change-prerequisites"; objectiveId: string; prerequisiteIds: string[] }
  | { kind: "deprecate"; objectiveId: string }
  | { kind: "rollback"; objectiveId: string; targetOperationId: string };

export interface StructuralRevisionProposal {
  operationId: string;
  programId: string;
  baseVersion: number;
  rationale: string;
  action: StructuralRevisionAction;
}

export interface StructuralRevisionPreview {
  operationId: string;
  programId: string;
  fromVersion: number;
  toVersion: number;
  kind: StructuralRevisionAction["kind"];
  rationale: string;
  before: LearningObjective;
  after: LearningObjective;
  changedFields: string[];
  revertedOperationId?: string;
}

/**
 * Manual/agent-suggested proposals have zero write authority.
 * This validator is also run inside the serialized approval transaction.
 */
export function previewStructuralRevision(
  program: LearningProgram, proposal: StructuralRevisionProposal,
): StructuralRevisionPreview {
  if (program.focus) throw new Error("End the active or paused focus before revising the curriculum.");
  if (proposal.programId !== program.id) throw new Error("Revision belongs to a different program.");
  if (proposal.baseVersion !== program.planVersion) throw new Error("Curriculum version conflict.");
  if (!/^[a-zA-Z0-9:_-]{6,100}$/.test(proposal.operationId)) {
    throw new Error("Invalid revision operation identity.");
  }
  if (!proposal.rationale || proposal.rationale.trim().length < 8 ||
      proposal.rationale.length > 500) {
    throw new Error("A specific rationale of 8–500 characters is required.");
  }
  const action = proposal.action;
  const before = program.objectives.find(item => item.id === action.objectiveId);
  if (!before) throw new Error("Unknown revision objective.");
  if (before.deprecated && action.kind !== "rollback") throw new Error("Cannot revise a deprecated objective.");
  let after: LearningObjective;
  if (action.kind === "revise") {
    const allowed = ["title", "outcome", "estimatedMinutes", "priority"];
    const keys = Object.keys(action.changes);
    if (keys.length === 0 || keys.some(key => !allowed.includes(key))) {
      throw new Error("Only non-rubric objective metadata can be revised in place.");
    }
    after = { ...structuredClone(before), ...action.changes };
  } else if (action.kind === "change-prerequisites") {
    if (!Array.isArray(action.prerequisiteIds) ||
        new Set(action.prerequisiteIds).size !== action.prerequisiteIds.length ||
        action.prerequisiteIds.some(id => !program.objectives.some(item =>
          item.id === id && !item.deprecated))) {
      throw new Error("Prerequisites must be unique, existing and active.");
    }
    after = { ...structuredClone(before), prerequisiteIds: [...action.prerequisiteIds] };
  } else if (action.kind === "deprecate") {
    if (program.objectives.some(item => item.id !== before.id &&
        item.prerequisiteIds.includes(before.id) && !item.deprecated)) {
      throw new Error("Rewire dependent objectives before deprecating this objective.");
    }
    after = { ...structuredClone(before), deprecated: true };
  } else if (action.kind === "rollback") {
    // Limit v1 rollback to the latest approved structural mutation. This prevents
    // undoing an older step while keeping newer dependent revisions in place.
    const previous = program.curriculumRevisions?.at(-1);
    if (!previous || previous.operationId !== action.targetOperationId ||
        previous.targetObjectiveId !== before.id || !previous.before || !previous.after ||
        !["revise", "change-prerequisites", "deprecate", "rollback"].includes(previous.kind)) {
      throw new Error("Rollback requires the latest approved structural revision on this objective.");
    }
    if (JSON.stringify(before) !== JSON.stringify(previous.after)) {
      throw new Error("Rollback target changed since the recorded revision.");
    }
    after = structuredClone(previous.before);
  } else {
    throw new Error("Unsupported structural revision action.");
  }
  // Revalidate the complete graph, exclusions, source authority and all stable rubric IDs.
  validateCurriculum({ kind: "curriculum", objectives: program.objectives.map(item =>
    item.id === before.id ? after : item) }, program.constraints);
  const changedFields = (["title", "outcome", "estimatedMinutes", "priority",
    "prerequisiteIds", "deprecated"] as const).filter(key =>
    JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (changedFields.length === 0) throw new Error("Revision has no effective changes.");
  return {
    operationId: proposal.operationId, programId: program.id,
    fromVersion: program.planVersion, toVersion: program.planVersion + 1,
    kind: action.kind, rationale: proposal.rationale,
    before: structuredClone(before), after: structuredClone(after),
    changedFields,
    ...(action.kind === "rollback" ? { revertedOperationId: action.targetOperationId } : {}),
  };
}

export function applyStructuralRevision(
  program: LearningProgram, proposal: StructuralRevisionProposal,
): LearningProgram {
  const prior = program.curriculumRevisions?.find(item => item.operationId === proposal.operationId);
  if (prior) {
    if (prior.kind !== proposal.action.kind || prior.targetObjectiveId !== proposal.action.objectiveId ||
        prior.fromVersion !== proposal.baseVersion || prior.rationale !== proposal.rationale ||
        (proposal.action.kind === "rollback" &&
          prior.revertedOperationId !== proposal.action.targetOperationId)) {
      throw new Error("Revision operation identity was reused for different content.");
    }
    return program;
  }
  const preview = previewStructuralRevision(program, proposal);
  const record: CurriculumRevisionRecord = {
    operationId: proposal.operationId, fromVersion: preview.fromVersion,
    toVersion: preview.toVersion, kind: proposal.action.kind,
    reasonEvidenceIds: [], targetObjectiveId: proposal.action.objectiveId,
    before: preview.before, after: preview.after, rationale: preview.rationale,
    ...(preview.revertedOperationId ? { revertedOperationId: preview.revertedOperationId } : {}),
  };
  return {
    ...program,
    objectives: program.objectives.map(item =>
      item.id === preview.before.id ? structuredClone(preview.after) : item),
    planVersion: preview.toVersion,
    curriculumRevisions: [...(program.curriculumRevisions ?? []), record],
  };
}
