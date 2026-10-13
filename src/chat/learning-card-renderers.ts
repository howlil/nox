import type { PracticeQuestion, PracticeEvaluation } from "../domain/practice/types";
import type { ReviewFinding } from "../domain/review/types";
import { createNoxButton, createNoxSurface } from "./primitives";

/** Feature rendering only: learning and navigation effects belong to ChatView. */
export function renderPracticeQuestionCard(parent: HTMLElement, question: PracticeQuestion): void {
  const card = createNoxSurface(parent, "nox-practice-card");
  card.createDiv({ cls: "nox-practice-label", text: `Practice · ${question.concept}` });
  card.createDiv({ cls: "nox-practice-question", text: question.question });
  if (question.hint) {
    card.createDiv({ cls: "nox-practice-hint", text: `Hint: ${question.hint}` });
  }
}

export function renderPracticeEvaluationCard(parent: HTMLElement, evaluation: PracticeEvaluation): void {
  const card = createNoxSurface(
    parent,
    `nox-practice-evaluation nox-outcome--${evaluation.outcome}`,
  );
  const outcomeLabel = evaluation.outcome === "correct" ? "Correct"
    : evaluation.outcome === "partial" ? "Partial" : "Needs work";
  card.createDiv({
    cls: "nox-practice-label",
    text: `${outcomeLabel} · ${evaluation.concept}`,
  });
  card.createDiv({ cls: "nox-practice-feedback", text: evaluation.feedback });

  if (evaluation.misconceptions.length > 0) {
    const gaps = card.createDiv({ cls: "nox-practice-gaps" });
    gaps.createDiv({ cls: "nox-practice-gaps-label", text: "Gap" });
    for (const misconception of evaluation.misconceptions) {
      gaps.createDiv({ cls: "nox-practice-gap", text: misconception });
    }
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
