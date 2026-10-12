import type { PracticeQuestion, PracticeEvaluation, PracticeOrigin } from "../learning/practice-types";
import type { ReviewFinding } from "../learning/review-types";

/** Durable structured assistant content. Legacy text/proposal fields remain readable. */
export type TranscriptPart =
  | { type: "practice-question"; question: PracticeQuestion; origin?: PracticeOrigin }
  | { type: "practice-evaluation"; evaluation: PracticeEvaluation }
  | { type: "review-findings"; findings: ReviewFinding[]; sourcePath?: string };
