import type { PracticeQuestion, PracticeEvaluation } from "../../../../packages/core/src/domain/practice/types";
import { createNoxButton, createNoxSurface, setNoxIcon } from "../../../chat/primitives";
import { renderQuizCard, type QuizCardActions } from "./quiz-card";
import { renderPracticeInstructions } from "./practice-instructions";

/** Feature rendering only: learning and navigation effects belong to ChatView. */
export function renderPracticeQuestionCard(parent: HTMLElement, question: PracticeQuestion,
  actions?: QuizCardActions): void {
  if (actions) {
    renderQuizCard(parent, question, actions);
    return;
  }
  const card = createNoxSurface(parent, "nox-practice-card");
  card.createDiv({ cls: "nox-practice-label", text: `Practice · ${question.concept}` });
  renderPracticeInstructions(card, question);
  if (question.hint) {
    card.createDiv({ cls: "nox-practice-hint", text: "Need a hint? Type /hint to reveal it." });
  }
}

export interface PracticeFeedbackOptions {
  /** Available only from the committed question linked to this evaluation. */
  correctAnswer?: string;
  /** A new action is prepared in the existing composer, never auto-submitted. */
  onContinue?: () => void;
}

export function renderPracticeEvaluationCard(
  parent: HTMLElement,
  evaluation: PracticeEvaluation,
  options: PracticeFeedbackOptions = {},
): void {
  const card = createNoxSurface(
    parent, `nox-practice-evaluation nox-outcome--${evaluation.outcome}`,
  );
  const heading = card.createDiv({ cls: "nox-evaluation-heading" });
  const outcomeLabel = evaluation.outcome === "correct" ? "Correct"
    : evaluation.outcome === "partial" ? "Partially correct" : "Needs work";
  const icon = heading.createSpan({ cls: "nox-evaluation-mark", attr: { "aria-hidden": "true" } });
  setNoxIcon(icon, evaluation.outcome === "correct" ? "check-circle-2"
    : evaluation.outcome === "partial" ? "alert-circle" : "circle-x");
  heading.createSpan({ cls: "nox-practice-label", text: outcomeLabel + " · " + evaluation.concept });
  if (evaluation.assisted) {
    heading.createSpan({ cls: "nox-evaluation-assisted", text: "Hint used" });
  }
  card.createDiv({ cls: "nox-practice-feedback", text: evaluation.feedback });
  if (evaluation.assisted) {
    card.createDiv({ cls: "nox-evaluation-note",
      text: "Assisted attempt — this result is not independent recall evidence." });
  }

  if (evaluation.misconceptions.length > 0) {
    const gaps = card.createDiv({ cls: "nox-practice-gaps" });
    gaps.createDiv({ cls: "nox-practice-gaps-label", text: "What to revisit" });
    for (const misconception of evaluation.misconceptions) {
      gaps.createDiv({ cls: "nox-practice-gap", text: misconception });
    }
  }

  // Disclosure follows an already-persisted evaluation. Never reveal the
  // answer key from a live unanswered MCQ or run code in the renderer.
  if (options.correctAnswer || evaluation.rubricResults?.length) {
    const details = card.createEl("details", { cls: "nox-evaluation-reveal" });
    details.createEl("summary", { text: options.correctAnswer
      ? "Reveal correct answer & criteria" : "Review scoring criteria" });
    const body = details.createDiv({ cls: "nox-evaluation-reveal-body" });
    if (options.correctAnswer) {
      const solution = body.createDiv({ cls: "nox-evaluation-solution" });
      solution.createDiv({ cls: "nox-quiz-section-heading", text: "Correct answer" });
      solution.createDiv({ cls: "nox-evaluation-solution-text", text: options.correctAnswer });
    }
    if (evaluation.rubricResults?.length) {
      const rubric = body.createDiv({ cls: "nox-evaluation-rubric" });
      rubric.createDiv({ cls: "nox-quiz-section-heading", text: "Criteria" });
      for (const item of evaluation.rubricResults) {
        const row = rubric.createDiv({ cls: "nox-evaluation-rubric-row" });
        const mark = row.createSpan({ cls: "nox-evaluation-rubric-mark",
          text: item.met ? "Met" : "Missing" });
        mark.addClass(item.met ? "is-met" : "is-missing");
        const content = row.createDiv({ cls: "nox-evaluation-rubric-content" });
        content.createDiv({ cls: "nox-evaluation-rubric-name", text: item.criterion });
        if (item.evidence) content.createDiv({ cls: "nox-evaluation-rubric-evidence", text: item.evidence });
      }
    }
  }

  if (options.onContinue) {
    const actions = card.createDiv({ cls: "nox-evaluation-actions" });
    const button = createNoxButton(actions, {
      cls: "nox-evaluation-continue", variant: "quiet",
      text: "Prepare next activity", icon: "arrow-right",
    });
    button.addEventListener("click", options.onContinue);
  }
}

