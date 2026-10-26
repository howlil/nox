import type { LearningProgram, CurriculumRevision, StructuralGapReason } from "./types";

/** Portable preview contract. Does not authorize or commit a revision. */
export interface CurriculumRevisionPreview {
  operationId: string;
  programId: string;
  fromVersion: number;
  toVersion: number;
  reason: StructuralGapReason;
  reasonEvidenceIds: string[];
  operations: CurriculumRevision["operations"];
  expiresAt: number;
  before: LearningProgram["objectives"];
  after: LearningProgram["objectives"];
}
