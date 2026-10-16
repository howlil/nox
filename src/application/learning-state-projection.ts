import {
  LearningEvidence,
  LearningState,
  KnowledgeGap,
} from "../domain/learning-state/types";

export interface PromptLearningState {
  version: 2;
  target: string | null;
  currentTopic?: string;
  gaps: KnowledgeGap[];
  recentEvidence: LearningEvidence[];
}

export const MAX_PROMPT_GAPS = 20;
export const MAX_PROMPT_EVIDENCE = 20;

export function toPromptLearningState(
  state: LearningState,
  programId?: string,
): PromptLearningState {
  return {
    version: 2,
    target: state.target,
    currentTopic: state.currentTopic,
    gaps: state.gaps
      .filter((gap) => gap.status !== "resolved" &&
        (programId === undefined || gap.programId === programId))
      .slice(-MAX_PROMPT_GAPS)
      .map((gap) => ({
        ...gap,
        evidenceIds: [...gap.evidenceIds],
      })),
    recentEvidence: state.evidence
      .filter(item => programId === undefined ||
        (item.scope === "learner" && item.programId === programId))
      .slice(-MAX_PROMPT_EVIDENCE)
      .map((item) => ({ ...item })),
  };
}
