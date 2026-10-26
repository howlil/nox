export interface KnowledgeGap {
  id: string;
  concept: string;
  reason: string;
  evidenceIds: string[];
  status: "open" | "improving" | "resolved";
  programId?: string;
  objectiveId?: string;
  /** Links gap resolution to exactly one versioned rubric criterion. */
  criterionId?: string;
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
  assisted?: boolean;
  assessmentCoverage?: "single-item";
  taskKind?: "diagnostic" | "guided-practice" | "recall" | "transfer";
  rubricResults?: Array<{ criterion: string; criterionId?: string; met: boolean; evidence: string }>;
  evidenceVersion?: 3;
  questionId?: string;
  objectiveRevision?: number;
  assistance?: { highestHintLevel: 0 | 1 | 2 | 3 | 4; independent: boolean };
  evaluator?: "deterministic" | "llm-review" | "verified-execution";
}

export interface LearningState {
  version: 2 | 3;
  target: string | null;
  currentTopic?: string;
  gaps: KnowledgeGap[];
  evidence: LearningEvidence[];
}

export const DEFAULT_LEARNING_STATE: LearningState = {
  version: 2,
  target: null,
  gaps: [],
  evidence: [],
};
