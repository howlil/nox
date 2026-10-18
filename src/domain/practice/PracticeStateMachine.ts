import {
  PracticeEvaluation,
  PracticeQuestion,
  PracticeSession,
  PracticeOrigin,
} from "./types";

export interface PracticeEvaluationAttempt {
  id: string;
  sessionId: string;
  questionId: string;
  origin?: PracticeOrigin;
  question: string;
  questionSpec?: PracticeQuestion;
  concept?: string;
  answer: string;
  programId?: string;
  objectiveId?: string;
  focusSessionId?: string;
  assisted?: boolean;
  highestHintLevel: 0 | 1 | 2 | 3 | 4;
  objectiveRevision?: number;
  taskKind?: "diagnostic" | "guided-practice" | "recall" | "transfer";
}

export class PracticeStateMachine {
  private session: PracticeSession | null = null;

  constructor(
    private readonly makeId: () => string = () =>
      crypto.randomUUID(),
  ) {}

  reset(): void {
    this.session = null;
  }

  start(origin?: PracticeOrigin): PracticeSession {
    this.session = {
      id: this.makeId(),
      origin,
      state: "generating",
      turns: [],
    };
    return this.session;
  }

  snapshot(): PracticeSession | null {
    return this.session;
  }

  isWaitingForAnswer(): boolean {
    return Boolean(
      this.session?.state === "waiting-answer" &&
        this.session.currentQuestion,
    );
  }

  acceptQuestion(question: PracticeQuestion, questionId?: string): void {
    if (!this.session) {
      this.start();
    }

    const session = this.session!;
    session.concept = question.concept;
    session.currentQuestion = question.question;
    session.state = "waiting-answer";

    const current = session.turns[session.turns.length - 1];
    if (
      current &&
      !current.answer &&
      current.question === question.question
    ) {
      return;
    }

    session.turns.push({
      id: questionId ?? this.makeId(),
      concept: question.concept,
      question: question.question,
      hint: question.hint,
      questionSpec: question,
      programId: question.programId,
      objectiveId: question.objectiveId,
      taskKind: question.taskKind,
    });
  }

  /** Reading an available hint must not mutate evidence eligibility. */
  peekHint(): string | undefined {
    const current = this.session?.turns[this.session.turns.length - 1];
    return this.isWaitingForAnswer() ? current?.hint : undefined;
  }

  markHintUsed(level: 1 | 2 | 3 | 4 = 1): string | undefined {
    const current = this.session?.turns[this.session.turns.length - 1];
    if (!current || !this.isWaitingForAnswer()) return undefined;
    if (!current.hint) return undefined;
    current.assisted = true;
    current.highestHintLevel = Math.max(current.highestHintLevel ?? 0, level) as 1 | 2 | 3 | 4;
    return current.hint;
  }

  /** Explicit clarification counts as guidance, never as an evaluation attempt. */
  markClarificationUsed(): void {
    const current = this.session?.turns[this.session.turns.length - 1];
    if (!current || !this.isWaitingForAnswer()) return;
    current.assisted = true;
    current.highestHintLevel = Math.max(current.highestHintLevel ?? 0, 1) as 1 | 2 | 3 | 4;
  }

  beginEvaluation(
    answer: string,
  ): PracticeEvaluationAttempt | null {
    const session = this.session;

    if (
      !session ||
      session.state !== "waiting-answer" ||
      !session.currentQuestion
    ) {
      return null;
    }

    const attempt: PracticeEvaluationAttempt = {
      id: this.makeId(),
      sessionId: session.id,
      questionId: session.turns[session.turns.length - 1]!.id,
      origin: session.origin,
      question: session.currentQuestion,
      questionSpec: session.turns[session.turns.length - 1]?.questionSpec,
      concept: session.concept,
      answer,
      programId: session.turns[session.turns.length - 1]?.programId,
      objectiveId: session.turns[session.turns.length - 1]?.objectiveId,
      focusSessionId: session.turns[session.turns.length - 1]?.questionSpec?.focusSessionId,
      assisted: session.turns[session.turns.length - 1]?.assisted,
      highestHintLevel: session.turns[session.turns.length - 1]?.highestHintLevel ?? 0,
      objectiveRevision: session.turns[session.turns.length - 1]?.questionSpec?.objectiveRevision,
      taskKind: session.turns[session.turns.length - 1]?.taskKind,
    };

    session.state = "evaluating";
    return attempt;
  }

  commitEvaluation(
    attempt: PracticeEvaluationAttempt,
    evaluation: PracticeEvaluation,
    nextQuestionId?: string,
  ): PracticeQuestion | undefined {
    const session = this.session;

    if (
      !session ||
      session.id !== attempt.sessionId ||
      session.state !== "evaluating" ||
      session.currentQuestion !== attempt.question
    ) {
      throw new Error(
        "Practice evaluation no longer matches the active question.",
      );
    }

    const current = session.turns[session.turns.length - 1];
    if (!current || current.question !== attempt.question) {
      throw new Error(
        "Practice session is missing the active question turn.",
      );
    }

    current.answer = attempt.answer;
    current.evaluation = evaluation;
    session.concept = evaluation.concept;

    const nextQuestion = evaluation.nextQuestion?.trim();

    if (!nextQuestion) {
      session.state = "complete";
      session.currentQuestion = undefined;
      return undefined;
    }

    const next: PracticeQuestion = {
      kind: "question",
      concept: evaluation.concept,
      question: nextQuestion,
    };

    session.state = "waiting-answer";
    session.currentQuestion = nextQuestion;
    session.turns.push({
      id: nextQuestionId ?? this.makeId(),
      concept: next.concept,
      question: next.question,
    });

    return next;
  }

  rollbackEvaluation(
    attempt: PracticeEvaluationAttempt,
  ): void {
    const session = this.session;

    if (
      !session ||
      session.id !== attempt.sessionId ||
      session.state !== "evaluating" ||
      session.currentQuestion !== attempt.question
    ) {
      return;
    }

    session.state = "waiting-answer";
  }
}
