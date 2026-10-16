import type { KnowledgeGap, LearningEvidence } from "../domain/learning-state/types";
import type { LearningProgram, ProgramCollection } from "../domain/learning-program/types";
import { projectLearnerModel } from "../domain/learner-model/learner-memory";

/**
 * A short-lived authority capability for one inference, not persisted state.
 * All values are application-owned, never inferred from provider payloads.
 */
export interface LearningAuthoritySnapshot {
  version: 1;
  programId: string;
  planVersion: number;
  objectiveId: string;
  chatSessionId: string;
  focus: { id: string; status: "active" | "paused"; objectiveId: string;
    curriculumRevision: number; chatSessionId?: string } | null;
  sessionStartedAt: number | null;
  evidenceRevision: string;
}

export function captureLearningAuthority(program: LearningProgram,
  objectiveId: string, chatSessionId: string, evidence: readonly LearningEvidence[],
  gaps: readonly KnowledgeGap[] = [],
): LearningAuthoritySnapshot {
  if (!program.objectives.some(o => o.id === objectiveId && !o.deprecated)) {
    throw new Error("Learning objective is no longer part of the active curriculum.");
  }
  if (program.focus && (program.focus.status !== "active" ||
      program.focus.objectiveId !== objectiveId ||
      program.focus.curriculumRevision !== program.planVersion ||
      (program.focus.chatSessionId && program.focus.chatSessionId !== chatSessionId))) {
    throw new Error("Objective focus does not authorize this inference.");
  }
  return {
    version: 1, programId: program.id, planVersion: program.planVersion,
    objectiveId, chatSessionId,
    focus: program.focus ? {
      id: program.focus.id, status: program.focus.status,
      objectiveId: program.focus.objectiveId,
      curriculumRevision: program.focus.curriculumRevision,
      chatSessionId: program.focus.chatSessionId,
    } : null,
    sessionStartedAt: program.session?.startedAt ?? null,
    evidenceRevision: projectLearnerModel(program, evidence, gaps).evidenceRevision,
  };
}

/** Fail-closed on any authority drift; never rebind a finished provider response. */
export function assertLearningAuthority(snapshot: LearningAuthoritySnapshot,
  collection: ProgramCollection, evidence: readonly LearningEvidence[],
  chatSessionId: string, objectiveId: string, gaps: readonly KnowledgeGap[] = []): void {
  if (snapshot.version !== 1 || snapshot.chatSessionId !== chatSessionId ||
      snapshot.objectiveId !== objectiveId ||
      collection.activeProgramId !== snapshot.programId) {
    throw new Error("Learning identity changed during inference.");
  }
  const current = collection.programs.find(item => item.id === snapshot.programId);
  if (!current || current.planVersion !== snapshot.planVersion ||
      !current.objectives.some(item => item.id === objectiveId && !item.deprecated)) {
    throw new Error("Curriculum changed during inference.");
  }
  const currentFocus = current.focus ? {
    id: current.focus.id, status: current.focus.status,
    objectiveId: current.focus.objectiveId,
    curriculumRevision: current.focus.curriculumRevision,
    chatSessionId: current.focus.chatSessionId,
  } : null;
  if (JSON.stringify(currentFocus) !== JSON.stringify(snapshot.focus) ||
      (current.session?.startedAt ?? null) !== snapshot.sessionStartedAt) {
    throw new Error("Objective focus or learning session changed during inference.");
  }
  const latest = projectLearnerModel(current, evidence, gaps).evidenceRevision;
  if (latest !== snapshot.evidenceRevision) {
    throw new Error("Learning evidence changed during inference. Select a new activity.");
  }
}
