export interface PracticeOrigin {
  file: string;
  selectedText?: string;
}

export interface PracticeQuestion {
  kind: "question";
  concept: string;
  question: string;
  hint?: string;
  programId?: string;
  objectiveId?: string;
}

export interface PracticeEvaluation {
  kind: "evaluation";
  concept: string;
  outcome: "correct" | "partial" | "incorrect";
  feedback: string;
  misconceptions: string[];
  nextQuestion?: string;
  programId?: string;
  objectiveId?: string;
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
  hint?: string;
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
