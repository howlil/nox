import assert from "node:assert/strict";
import test from "node:test";
import {
  renderPracticeQuestionCard,
  renderPracticeEvaluationCard,
  renderReviewFindingCards,
} from "../../src/chat/learning-card-renderers";

class FakeElement {
  readonly children: FakeElement[] = [];
  private handlers = new Map<string, () => void>();
  constructor(readonly tag = "div", readonly cls = "", readonly text = "") {}
  createDiv(options: { cls?: string; text?: string } = {}): FakeElement {
    const child = new FakeElement("div", options.cls, options.text);
    this.children.push(child);
    return child;
  }
  createEl(tag: string, options: { cls?: string; text?: string } = {}): FakeElement {
    const child = new FakeElement(tag, options.cls, options.text);
    this.children.push(child);
    return child;
  }
  addEventListener(type: string, handler: () => void): void {
    this.handlers.set(type, handler);
  }
  click(): void { this.handlers.get("click")?.(); }
  find(cls: string): FakeElement | undefined {
    if (this.cls.includes(cls)) return this;
    for (const child of this.children) {
      const match = child.find(cls);
      if (match) return match;
    }
    return undefined;
  }
}
function asDom(value: FakeElement): HTMLElement {
  return value as unknown as HTMLElement;
}

test("practice cards retain question, feedback, and misconceptions", () => {
  const root = new FakeElement();
  renderPracticeQuestionCard(asDom(root), {
    kind: "question", concept: "index", question: "Why B-trees?", hint: "IO",
  });
  renderPracticeEvaluationCard(asDom(root), {
    kind: "evaluation", concept: "index", outcome: "partial",
    feedback: "Missing IO cost", misconceptions: ["Disk seeks"],
  });
  assert.equal(root.find("nox-practice-question")?.text, "Why B-trees?");
  assert.equal(root.find("nox-practice-hint")?.text, "Hint: IO");
  assert.equal(root.find("nox-practice-feedback")?.text, "Missing IO cost");
  assert.equal(root.find("nox-practice-gap")?.text, "Disk seeks");
});

test("review controls relay the exact finding through supplied actions", () => {
  const root = new FakeElement();
  const finding = {
    kind: "missing-relation" as const,
    concept: "transactions", title: "Atomicity", detail: "Explain rollback",
  };
  const called: string[] = [];
  renderReviewFindingCards(asDom(root), [finding], {
    onPractice: (selected) => called.push("practice:" + selected.concept),
    onFix: (selected) => called.push("fix:" + selected.concept),
  });
  const buttons = root.find("nox-review-actions")!.children;
  assert.equal(buttons.length, 2);
  buttons[0].click();
  buttons[1].click();
  assert.deepEqual(called, ["practice:transactions", "fix:transactions"]);
});
