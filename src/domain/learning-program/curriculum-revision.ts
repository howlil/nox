import type { LearningEvidence } from "../learning-state/types";
import type { CurriculumRevisionRecord, LearningObjective, LearningProgram } from "./types";
import { validateCurriculum } from "./rules";

export interface CurriculumRevisionProposal {
  operationId: string;
  baseVersion: number;
  kind: "prerequisite-remediation";
  targetObjectiveId: string;
  addedObjective: LearningObjective;
  reasonEvidenceIds: string[];
}

/** Evidence-first micro-prerequisite proposal: no LLM authority or speculative skill labels. */
export function proposeRemediationRevision(
  program: LearningProgram, evidence: readonly LearningEvidence[],
): CurriculumRevisionProposal | null {
  if (program.focus) return null; // Never replace the graph beneath an active/paused focus.
  for (const objective of program.objectives) {
    const attempts = evidence.filter(item =>
      item.scope === "learner" && item.type === "practice" &&
      item.programId === program.id && item.objectiveId === objective.id &&
      (item.outcome === "incorrect" || item.outcome === "partial"))
      .sort((a,b) => a.createdAt - b.createdAt);
    for (const [index, criterion] of objective.rubric.entries()) {
      const failures = attempts.filter(item => item.rubricResults?.some(result =>
        result.criterion === criterion && !result.met));
      if (failures.length < 2) continue;
      // A later, independent rubric-complete outcome may have already repaired this gap.
      const lastFailure = failures[failures.length - 1].createdAt;
      if (evidence.some(item =>
        item.scope === "learner" && item.type === "practice" &&
        item.programId === program.id && item.objectiveId === objective.id &&
        item.createdAt > lastFailure && item.outcome === "correct" && !item.assisted &&
        Boolean(item.rubricResults?.some(result => result.criterion === criterion && result.met)))) continue;
      const id = objective.id.slice(0, 47) + "-repair-" + (index + 1);
      const operationId = "repair:" + objective.id + ":" + index;
      if (program.objectives.some(item => item.id === id) ||
          program.curriculumRevisions?.some(item => item.operationId === operationId)) continue;
      return {
        operationId, baseVersion: program.planVersion, kind: "prerequisite-remediation",
        targetObjectiveId: objective.id,
        addedObjective: { id, title: "Repair: " + objective.title,
          outcome: "Demonstrate independently: " + criterion,
          prerequisiteIds: [...objective.prerequisiteIds], estimatedMinutes: 30,
          rubric: [criterion], sourceRefs: [...objective.sourceRefs], priority: "supporting" },
        reasonEvidenceIds: failures.slice(-2).map(item => item.id),
      };
    }
  }
  return null;
}

export function applyCurriculumRevision(
  program: LearningProgram, proposal: CurriculumRevisionProposal,
): LearningProgram {
  if (program.curriculumRevisions?.some(item => item.operationId === proposal.operationId)) return program;
  if (program.focus) throw new Error("End objective focus before revising the curriculum.");
  if (program.planVersion !== proposal.baseVersion) throw new Error("Curriculum version conflict.");
  if (!proposal.operationId || proposal.reasonEvidenceIds.length < 2 ||
      new Set(proposal.reasonEvidenceIds).size !== proposal.reasonEvidenceIds.length) {
    throw new Error("Curriculum revision requires distinct evidence.");
  }
  const target = program.objectives.find(item => item.id === proposal.targetObjectiveId);
  if (!target || program.objectives.some(item => item.id === proposal.addedObjective.id) ||
      proposal.addedObjective.id === target.id) throw new Error("Invalid curriculum revision target.");
  if (proposal.addedObjective.prerequisiteIds.some(id => !target.prerequisiteIds.includes(id)) ||
      proposal.addedObjective.sourceRefs.some(ref => !target.sourceRefs.includes(ref))) {
    throw new Error("Remediation may not expand prerequisite or source authority.");
  }
  const objectives = program.objectives.map(item => item.id === target.id ?
    { ...item, prerequisiteIds: [...item.prerequisiteIds, proposal.addedObjective.id] } : item);
  objectives.splice(objectives.findIndex(item => item.id === target.id), 0,
    structuredClone(proposal.addedObjective));
  const validated = validateCurriculum({ kind: "curriculum", objectives }, program.constraints);
  const record: CurriculumRevisionRecord = {
    operationId: proposal.operationId, fromVersion: program.planVersion,
    toVersion: program.planVersion + 1, kind: proposal.kind,
    reasonEvidenceIds: [...proposal.reasonEvidenceIds], addedObjectiveId: proposal.addedObjective.id,
  };
  return { ...program, objectives: validated.objectives, planVersion: record.toVersion,
    curriculumRevisions: [...(program.curriculumRevisions ?? []), record] };
}
