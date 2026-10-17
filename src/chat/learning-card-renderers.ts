import type { PracticeQuestion, PracticeEvaluation } from "../domain/practice/types";
import type { ReviewFinding } from "../domain/review/types";
import { createNoxButton, createNoxSurface, setNoxIcon } from "./primitives";
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
    const level = evaluation.assistance?.highestHintLevel ?? 1;
    heading.createSpan({ cls: "nox-evaluation-assisted",
      text: level > 1 ? "Hint level " + level : "Hint used" });
  }
  card.createDiv({ cls: "nox-practice-feedback", text: evaluation.feedback });
  const missedCriteria = evaluation.rubricResults?.filter(item => !item.met)
    .map(item => item.criterion).slice(0, 2) ?? [];
  if (evaluation.programId && missedCriteria.length) {
    card.createDiv({ cls: "nox-evaluation-target",
      text: "Next focus: " + missedCriteria.join(" · ") });
  }
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

  if (evaluation.programId && evaluation.outcome !== "correct" && !missedCriteria.length) {
    card.createDiv({ cls: "nox-evaluation-note",
      text: "Next: explain the part you are unsure about in your own words." });
  }
  if (options.onContinue) {
    const actions = card.createDiv({ cls: "nox-evaluation-actions" });
    const button = createNoxButton(actions, {
      cls: "nox-evaluation-continue", variant: "quiet",
      text: evaluation.programId && evaluation.outcome !== "correct"
        ? "Try a correction" : "Prepare next activity", icon: "arrow-right",
    });
    button.addEventListener("click", options.onContinue);
  }
}

export interface ReviewFindingActions {
  onPractice: (finding: ReviewFinding) => void;
  onFix: (finding: ReviewFinding) => void;
}

export function renderReviewFindingCards(
  parent: HTMLElement,
  findings: ReviewFinding[],
  actions: ReviewFindingActions,
): void {
  const wrap = parent.createDiv({ cls: "nox-review" });
  wrap.createDiv({
    cls: "nox-review-summary",
    text: findings.length === 0
      ? "No material learning gaps found."
      : `${findings.length} important ${findings.length === 1 ? "gap" : "gaps"}`,
  });

  for (const finding of findings) {
    const card = createNoxSurface(wrap, `nox-review-card nox-review-card--${finding.kind}`);
    card.createDiv({ cls: "nox-review-kind", text: finding.kind.replace("-", " ") });
    card.createDiv({ cls: "nox-review-title", text: finding.title });
    card.createDiv({ cls: "nox-review-detail", text: finding.detail });
    const controls = card.createDiv({ cls: "nox-review-actions" });
    const practice = createNoxButton(controls, {
      cls: "nox-review-action", variant: "quiet", text: "Practice",
    });
    practice.addEventListener("click", () => actions.onPractice(finding));
    const fix = createNoxButton(controls, {
      cls: "nox-review-action", variant: "quiet", text: "Fix",
    });
    fix.addEventListener("click", () => actions.onFix(finding));
  }
}
