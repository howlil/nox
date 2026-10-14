import { AgentFailure, EditProposal } from "../types";
import {
  ExplicitContextRef,
  TurnContextSnapshot,
} from "../context/context-types";
import { LearningState } from "../domain/learning-state/types";
import {
  PracticeEvaluation,
  PracticeQuestion,
} from "../domain/practice/types";
import { ReviewFinding } from "../domain/review/types";

export type LearningActionKind =
  | "ask"
  | "explain"
  | "practice"
  | "review"
  | "edit";

export interface LearningRequest {
  prompt: string;
  action: LearningActionKind;
  explicitContext: ExplicitContextRef[];
  /** Origin of a Review finding; follow-ups must not silently retarget edits. */
  sourcePath?: string;
  /** A retry is another attempt at the same logical user turn. */
  retry?: boolean;
  /** Stable identity across Retry. New user submissions receive new IDs. */
  turnId?: string;
  programActivity?: { programId: string; objectiveId: string; kind: "teach" };
  freePractice?: boolean;
}

export interface ProposedEdit {
  id: string;
  proposal: EditProposal;
}

export type LearningEvent =
  | {
      type: "context-ready";
      context: TurnContextSnapshot;
    }
  | {
      type: "thought-delta";
      text: string;
    }
  | {
      type: "response-delta";
      text: string;
    }
  | {
      type: "practice-question";
      question: PracticeQuestion;
    }
  | {
      type: "practice-evaluation";
      evaluation: PracticeEvaluation;
    }
  | {
      type: "review-findings";
      findings: ReviewFinding[];
    }
  | {
      type: "mutation-proposed";
      edit: ProposedEdit;
    }
  | {
      type: "learning-state-updated";
      state: LearningState;
    }
  | {
      type: "completed";
    }
  | {
      type: "failed";
      failure: AgentFailure | { code: "timeout" | "busy"; message: string };
    }
  | {
      type: "cancelled";
    };
