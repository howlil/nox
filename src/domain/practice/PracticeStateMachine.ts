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
  concept?: string;
  answer: string;
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
    });
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
      concept: session.concept,
      answer,
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
