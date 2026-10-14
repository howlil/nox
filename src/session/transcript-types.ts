import type { PracticeQuestion, PracticeEvaluation, PracticeOrigin } from "../domain/practice/types";
import type { ReviewFinding } from "../domain/review/types";
import type { LearningScopeState } from "../domain/practice/learning-scope";
import type { ChatMessage } from "../types";

export interface ChatSession {
  id: string;
  learningScope?: LearningScopeState;
  conversationId?: string;
  /** Runtime cursor/model ownership; transcript and learning state are independent. */
  runtimeProvider?: string;
  model?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** Durable structured assistant content. Legacy text/proposal fields remain readable. */
export type TranscriptPart =
  | { type: "practice-question"; question: PracticeQuestion; questionId?: string; origin?: PracticeOrigin; scope?: "backend" }
  | { type: "practice-evaluation"; evaluation: PracticeEvaluation; questionId?: string;
      operationId?: string; nextQuestionId?: string; sourcePath?: string; scope?: "backend" }
  | { type: "review-findings"; findings: ReviewFinding[]; sourcePath?: string; reviewId?: string };

export function findCommittedReview(
  session: import("../types").ChatSession,
  reviewId: string,
): Extract<TranscriptPart, { type: "review-findings" }> | undefined {
  for (const message of session.messages) {
    for (const part of message.parts ?? []) {
      if (part.type === "review-findings" && part.reviewId === reviewId) return part;
    }
  }
  return undefined;
}

/** An outcome committed to the transcript is authoritative for its question. */
export function findCommittedPracticeOutcome(
  session: import("../types").ChatSession,
  questionId: string,
): Extract<TranscriptPart, { type: "practice-evaluation" }> | undefined {
  for (const message of session.messages) {
    for (const part of message.parts ?? []) {
      if (part.type === "practice-evaluation" && part.questionId === questionId) {
        return part;
      }
    }
  }
  return undefined;
}
