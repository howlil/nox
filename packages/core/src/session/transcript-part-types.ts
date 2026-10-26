import type { PracticeQuestion, PracticeEvaluation, PracticeOrigin } from "../domain/practice/types";
import type { ReviewFinding } from "../domain/review/types";

/** Shared durable parts; no executable transcript policy or root transport import. */
export type TranscriptPart =
  | { type: "practice-question"; question: PracticeQuestion; questionId?: string; origin?: PracticeOrigin; scope?: "backend" | "program" }
  | { type: "practice-evaluation"; evaluation: PracticeEvaluation; questionId?: string;
      operationId?: string; nextQuestionId?: string; sourcePath?: string; scope?: "backend" | "program" }
  | { type: "review-findings"; findings: ReviewFinding[]; sourcePath?: string; reviewId?: string };

