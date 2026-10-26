import type { ReviewFinding } from "../../packages/core/src/domain/review/types";
import { createNoxButton, createNoxSurface } from "./primitives";

/** Review finding controls remain in the host view shell; practice has its own view owner. */
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
