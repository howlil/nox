export interface KnowledgeGap {
  id: string;
  concept: string;
  reason: string;
  evidenceIds: string[];
  status: "open" | "improving" | "resolved";
}

export interface LearningEvidence {
  id: string;
  type: "practice" | "review" | "project";
  scope: "learner" | "material";
  concept: string;
  source: string;
  outcome?: string;
  createdAt: number;
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
