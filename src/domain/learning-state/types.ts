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
  assisted?: boolean;
  rubricResults?: Array<{ criterion: string; met: boolean; evidence: string }>;
}

export interface LearningState {
  version: 2;
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
