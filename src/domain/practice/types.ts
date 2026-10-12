export interface PracticeOrigin {
  file: string;
  selectedText?: string;
}

export interface PracticeQuestion {
  kind: "question";
  concept: string;
  question: string;
  hint?: string;
}

export interface PracticeEvaluation {
  kind: "evaluation";
  concept: string;
  outcome: "correct" | "partial" | "incorrect";
  feedback: string;
  misconceptions: string[];
  nextQuestion?: string;
}

export type PracticePayload =
  | PracticeQuestion
  | PracticeEvaluation;

export interface PracticeTurn {
  id: string;
  concept: string;
  question: string;
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
