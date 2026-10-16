export interface KnowledgeGap {
  id: string;
  concept: string;
  reason: string;
  evidenceIds: string[];
  status: "open" | "improving" | "resolved";
  programId?: string;
  objectiveId?: string;
}

export interface LearningEvidence {
  id: string;
  type: "practice" | "review" | "project";
  scope: "learner" | "material";
  concept: string;
  source: string;
  outcome?: string;
  createdAt: number;
  /** Stable program/objective identity prevents concept-name collisions across curricula. */
  programId?: string;
  objectiveId?: string;
  /** v3 provenance is optional only for historical records. */
  objectiveRevision?: number;
  questionId?: string;
  focusSessionId?: string;
  evaluator?: "deterministic" | "llm-review" | "verified-execution";
  assistance?: { highestHintLevel: 0 | 1 | 2 | 3 | 4; independent: boolean };
  assisted?: boolean;
  assessmentCoverage?: "single-item";
  taskKind?: "diagnostic" | "guided-practice" | "recall" | "transfer";
  rubricResults?: Array<{ criterion: string; criterionId?: string; met: boolean; evidence: string }>;
}

export interface LearningState {
  /** v2 remains an accepted in-memory input; storage promotes it to v3. */
  version: 2 | 3;
  target: string | null;
  currentTopic?: string;
  gaps: KnowledgeGap[];
  evidence: LearningEvidence[];
}

export const DEFAULT_LEARNING_STATE: LearningState = {
  version: 3,
  target: null,
  gaps: [],
  evidence: [],
};
