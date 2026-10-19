import type { PracticeAnswer } from "../domain/practice/types";
import type { LearningScopeState } from "../domain/practice/learning-scope";
import type { ChatMessage } from "./message-types";
import type { TranscriptPart } from "./transcript-part-types";
export type { TranscriptPart } from "./transcript-part-types";

export interface SessionForkOrigin {
  parentSessionId: string;
  parentMessageId: string;
  parentMessageIndex: number;
  inheritedMessageCount: number;
  createdAt: number;
}

export interface ChatSession {
  fork?: SessionForkOrigin;
  id: string;
  /** Archived sessions remain durable but do not appear in active history. */
  archivedAt?: number;
  learningScope?: LearningScopeState;
  conversationId?: string;
  /** Runtime cursor/model ownership; transcript and learning state are independent. */
  runtimeProvider?: string;
  model?: string;
  messages: ChatMessage[];
  /** Session-local unfinished inputs; only evaluated submissions become evidence. */
  practiceDrafts?: Record<string, PracticeAnswer>;
  createdAt: number;
  updatedAt: number;
}

/** Durable structured assistant content. Legacy text/proposal fields remain readable. */
export function findCommittedReview(
  session: ChatSession,
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
  session: ChatSession,
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
