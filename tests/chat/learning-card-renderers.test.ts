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
  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    return this.createEl("span", options);
  }
  empty(): void { this.children.splice(0); }
  querySelector(_selector: string): null { return null; }
  addClass(_className: string): void {}

  addEventListener(type: string, handler: () => void): void {
    this.handlers.set(type, handler);
  }
  click(): void { this.handlers.get("click")?.(); }
  find(cls: string): FakeElement | undefined {
    if (this.cls.split(/\s+/).includes(cls)) return this;
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
  assert.equal(root.find("nox-practice-question")?.children.map(x => x.text).join(""), "Why B-trees?");
  assert.equal(root.find("nox-practice-hint")?.text, "Need a hint? Type /hint to reveal it.");
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

test("feedback reveals the committed solution and rubric only in a native disclosure", () => {
  const root = new FakeElement();
  let prepares = 0;
  renderPracticeEvaluationCard(asDom(root), {
    kind: "evaluation", concept: "transactions", outcome: "incorrect",
    assisted: true, feedback: "Atomicity requires a rollback boundary.",
    misconceptions: ["Confuses rollback with retry"],
    rubricResults: [
      { criterion: "Explains rollback", met: false, evidence: "No rollback mentioned" },
    ],
  }, { correctAnswer: "A database transaction", onContinue: () => { prepares++; } });
  const details = root.find("nox-evaluation-reveal");
  assert.equal(details?.tag, "details");
  assert.equal(root.find("nox-evaluation-solution-text")?.text, "A database transaction");
  assert.equal(root.find("nox-evaluation-assisted")?.text, "Hint used");
  assert.equal(root.find("nox-evaluation-rubric-name")?.text, "Explains rollback");
  root.find("nox-evaluation-continue")?.click();
  assert.equal(prepares, 1);
});

test("feedback never invents an answer key when no committed MCQ option is supplied", () => {
  const root = new FakeElement();
  renderPracticeEvaluationCard(asDom(root), {
    kind: "evaluation", concept: "code", outcome: "partial",
    feedback: "Address the race condition.", misconceptions: [],
  });
  assert.equal(root.find("nox-evaluation-solution-text"), undefined);
  assert.equal(root.find("nox-evaluation-reveal"), undefined);
});
