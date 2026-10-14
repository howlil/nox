import { AgentFailure, EditProposal } from "../types";
import {
  ExplicitContextRef,
  TurnContextSnapshot,
} from "../context/context-types";
import { LearningState } from "../domain/learning-state/types";
import {
  PracticeEvaluation,
  PracticeQuestion,
  PracticeAnswer,
} from "../domain/practice/types";
import { ReviewFinding } from "../domain/review/types";
import type { LearningObjective, ActivityKind } from "../domain/learning-program/types";

/** Read-only graph derived from authoritative learner evidence. */
export interface NoxProgramOverview {
  goal: string;
  active: boolean;
  sessionTime?: {
    budgetMs: number; activeMs: number; remainingMs: number; aiWaitingMs: number;
    status: "active" | "waiting-ai" | "paused" | "recovered" | "exhausted";
  };
  next: { kind: ActivityKind; objectiveId?: string; reason: string };
  objectives: Array<{ objective: LearningObjective;
    status: "unseen" | "remediate" | "provisional" | "mastered";
    attempts: number; dueAt: number | null }>;
}


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
  /** Typed submit from an interactive card, validated against the active question. */
  practiceSubmission?: { questionId: string; answer: PracticeAnswer };
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
      questionId?: string;
    }
  | {
      type: "practice-evaluation";
      evaluation: PracticeEvaluation;
      /** Identity of the evaluated question, for post-commit UI reveal. */
      questionId?: string;
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
  | { type: "tool-started"; toolCallId: string; name: string }
  | { type: "tool-completed"; toolCallId: string; outcome: "completed" | "failed" }
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
