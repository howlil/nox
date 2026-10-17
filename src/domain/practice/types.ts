export interface RubricResult {
  criterion: string;
  met: boolean;
  evidence: string;
}
export function isRubricResults(value: unknown): value is RubricResult[] {
  return Array.isArray(value) && value.length <= 20 && value.every(item => {
    if (!item || typeof item !== "object") return false;
    const r = item as Record<string, unknown>;
    return typeof r.criterion === "string" && r.criterion.trim().length > 0 &&
      typeof r.met === "boolean" && typeof r.evidence === "string";
  });
}

export interface PracticeOrigin {
  file: string;
  selectedText?: string;
}

/** Quiz input belongs to the existing Practice aggregate; old questions remain essays. */
export type PracticeInput =
  | { type: "multiple-choice"; options: Array<{ id: string; text: string }>;
      correctOptionId: string; explanation: string }
  | { type: "essay"; criteria?: string[]; minWords?: number }
  | { type: "code"; language: string; starterCode?: string; criteria?: string[];
      executionMode: "review-only" };

export type PracticeAnswer =
  | { type: "multiple-choice"; optionId: string }
  | { type: "essay"; text: string }
  | { type: "code"; language: string; source: string };

/** Structured reading order for a practice instruction; no HTML or executable markup. */
export interface PracticeInstructions {
  title?: string;
  brief?: string;
  tasks?: string[];
  requirements?: string[];
  given?: string[];
  expectedOutput?: string[];
  /** Reference-only, never inserted into the editable answer automatically. */
  referenceCode?: string;
}

export interface PracticeQuestion {
  kind: "question";
  concept: string;
  question: string;
  hint?: string;
  /** Structured learning brief. Existing plain-text questions remain valid. */
  instructions?: PracticeInstructions;
  /** Optional for backward-compatible question cards. */
  input?: PracticeInput;
  programId?: string;
  objectiveId?: string;
  /** Application-bound focus ID; never trusted from provider output. */
  focusSessionId?: string;
  taskKind?: "diagnostic" | "guided-practice" | "recall" | "transfer";
}

export interface PracticeEvaluation {
  kind: "evaluation";
  concept: string;
  outcome: "correct" | "partial" | "incorrect";
  feedback: string;
  misconceptions: string[];
  nextQuestion?: string;
  assisted?: boolean;
  rubricResults?: RubricResult[];
  taskKind?: "diagnostic" | "guided-practice" | "recall" | "transfer";
  /** A single MCQ cannot prove a complete learning objective. */
  assessmentCoverage?: "single-item";
  programId?: string;
  objectiveId?: string;
  focusSessionId?: string;
}

export type PracticePayload =
  | PracticeQuestion
  | PracticeEvaluation;

export interface PracticeTurn {
  id: string;
  concept: string;
  question: string;
  programId?: string;
  objectiveId?: string;
  taskKind?: "diagnostic" | "guided-practice" | "recall" | "transfer";
  hint?: string;
  questionSpec?: PracticeQuestion;
  assisted?: boolean;
  answer?: string;
  evaluation?: PracticeEvaluation;
}

export interface PracticeSession {
  id: string;
  origin?: PracticeOrigin;
  concept?: string;
  state:
    | "generating"
    | "waiting-answer"
    | "evaluating"
    | "complete";
  currentQuestion?: string;
  turns: PracticeTurn[];
}
