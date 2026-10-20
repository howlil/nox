import type { ChatSession } from "../../../types";
import type { PracticeAnswer, PracticeQuestion, PracticeEvaluation } from "../../../domain/practice/types";
import { renderPracticeQuestionCard, renderPracticeEvaluationCard } from "./PracticeCards";

/** UI-only capabilities: the caller owns authorization, turn execution and persistence. */
export interface PracticeUiCallbacks {
  session(): ChatSession;
  hasActiveQuestion(): boolean;
  isBusy(): boolean;
  saveDraft(questionId: string, answer: PracticeAnswer, sessionId: string): Promise<void>;
  requestHint(question: PracticeQuestion, sessionId: string): Promise<boolean>;
  submit(questionId: string, answer: PracticeAnswer, sessionId: string): Promise<boolean>;
  clarify(): void;
  prepareContinue(evaluation: PracticeEvaluation, sessionId: string): void;
  reportError(message: string): void;
}

/** Owns quiz DOM projection and the only outstanding draft debounce.
 * The app/session layer remains the authority for active question identity.
 */
export class PracticePresenter {
  private draftTimer: number | null = null;
  private pendingDraft: { questionId: string; answer: PracticeAnswer; sessionId: string; epoch: number } | null = null;
  private epoch = 0;

  constructor(private readonly actions: PracticeUiCallbacks) {}

  reset(): void {
    ++this.epoch;
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    this.draftTimer = null;
    this.pendingDraft = null;
  }

  /** Commit a pending typed answer before navigation/close; never write to another session. */
  async flushDraft(): Promise<void> {
    if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
    this.draftTimer = null;
    const draft = this.pendingDraft;
    if (!draft) return;
    // Keep the pending draft if persistence fails, allowing the user to retry.
    if (draft.epoch !== this.epoch || this.actions.session().id !== draft.sessionId ||
        this.actions.isBusy()) return;
    await this.actions.saveDraft(draft.questionId, draft.answer, draft.sessionId);
    if (this.pendingDraft === draft) this.pendingDraft = null;
  }

  dispose(): void { this.reset(); }

  renderQuestion(parent: HTMLElement, question: PracticeQuestion, questionId?: string): void {
    const session = this.actions.session();
    const current = [...session.messages].reverse().flatMap(message =>
      (message.parts ?? []).filter(part => part.type === "practice-question"));
    const active = Boolean(questionId && current[0]?.questionId === questionId &&
      this.actions.hasActiveQuestion() &&
      !session.messages.some(message => message.parts?.some(part =>
        part.type === "practice-evaluation" && part.questionId === questionId)));
    const index = questionId ? session.messages.findIndex(message => message.parts?.some(part =>
      part.type === "practice-question" && part.questionId === questionId)) : -1;
    const hintUsed = index >= 0 && session.messages.slice(index + 1).some(message =>
      message.role === "user" && message.content.trim().toLowerCase() === "/hint");

    // A newly rendered question or restored transcript invalidates old draft writes.
    this.reset();
    const epoch = this.epoch;
    const stillCurrent = () => epoch === this.epoch &&
      this.actions.session().id === session.id && !this.actions.isBusy();

    renderPracticeQuestionCard(parent, question, questionId ? {
      questionId, active, hintUsed, draft: session.practiceDrafts?.[questionId],
      onDraft: answer => {
        if (!active || !stillCurrent()) return;
        if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
        this.pendingDraft = { questionId, answer, sessionId: session.id, epoch };
        this.draftTimer = window.setTimeout(() => {
          if (!stillCurrent()) return;
          void this.flushDraft().catch(() => this.actions.reportError("Could not save quiz draft."));
        }, 450);
      },
      onClarify: () => {
        if (active && stillCurrent()) this.actions.clarify();
      },
      onHint: async () => {
        if (!active || !stillCurrent() || !this.actions.hasActiveQuestion()) return false;
        return this.actions.requestHint(question, session.id);
      },
      onSubmit: async answer => {
        if (!active || !stillCurrent()) return false;
        if (this.draftTimer !== null) window.clearTimeout(this.draftTimer);
        this.draftTimer = null;
        this.pendingDraft = null;
        return this.actions.submit(questionId, answer, session.id);
      },
    } : undefined);
  }

  renderEvaluation(parent: HTMLElement, evaluation: PracticeEvaluation, questionId?: string): void {
    const session = this.actions.session();
    const part = questionId ? session.messages.flatMap(message => message.parts ?? [])
      .find(item => item.type === "practice-question" && item.questionId === questionId) : undefined;
    const question = part?.type === "practice-question" ? part.question : undefined;
    const input = question?.input;
    const choice = input?.type === "multiple-choice"
      ? input.options.find(option => option.id === input.correctOptionId) : undefined;
    renderPracticeEvaluationCard(parent, evaluation, {
      correctAnswer: choice?.text,
      onContinue: this.actions.hasActiveQuestion() ? undefined : () => {
        if (this.actions.session().id !== session.id || this.actions.isBusy()) return;
        this.actions.prepareContinue(evaluation, session.id);
      },
    });
  }
}
