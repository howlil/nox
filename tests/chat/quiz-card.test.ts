import assert from "node:assert/strict";
import test from "node:test";
import { renderQuizCard } from "../../src/chat/quiz-card";
import type { PracticeQuestion, PracticeAnswer } from "../../src/domain/practice/types";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly handlers = new Map<string, (event?: { key?: string; shiftKey?: boolean;
    preventDefault(): void }) => void>();
  checked = false;
  disabled = false;
  value = "";
  textContent = "";
  selectionStart = 0;
  selectionEnd = 0;
  rows = 0;
  spellcheck = true;
  name = "";
  type = "";
  placeholder = "";
  constructor(readonly tag = "div", readonly cls = "", public text = "") {}
  createDiv(o: { cls?: string; text?: string } = {}) {
    const child = new FakeElement("div", o.cls, o.text);
    this.children.push(child); return child;
  }
  createSpan(o: { cls?: string; text?: string } = {}) { const child = new FakeElement("span", o.cls, o.text); this.children.push(child); return child; }
  createEl(tag: string, o: { cls?: string; text?: string; type?: string } = {}) {
    const child = new FakeElement(tag, o.cls, o.text);
    child.type = o.type || "";
    this.children.push(child); return child;
  }
  setAttribute(_k: string, _v: string) {}
  setText(text: string) { this.text = text; this.textContent = text; }
  addEventListener(name: string, cb: (event?: any) => void) { this.handlers.set(name, cb); }
  trigger(name: string) { this.handlers.get(name)?.({ preventDefault() {} }); }
  findAll(tag: string): FakeElement[] { return [
    ...(this.tag === tag ? [this] : []),
    ...this.children.flatMap(child => child.findAll(tag)),
  ]; }
  findClass(cls: string): FakeElement | undefined {
    return this.cls.split(" ").includes(cls) ? this :
      this.children.map(c => c.findClass(cls)).find(Boolean);
  }
  querySelectorAll<T>(_q: string): T[] { return [
    ...this.findAll("input"), ...this.findAll("textarea"),
  ] as T[]; }
  setRangeText(text: string) { this.value += text; }
}
const dom = (x: FakeElement) => x as unknown as HTMLElement;
const question: PracticeQuestion = {
  kind: "question", concept: "Spring", question: "Which is DI?",
  input: { type: "multiple-choice", correctOptionId: "b", explanation: "Constructor injection",
    options: [{ id: "a", text: "new Foo()" }, { id: "b", text: "Constructor" }] },
  hint: "Look for an external dependency.",
};

test("MCQ card selects an answer, saves draft, submits and locks on commit", async () => {
  const root = new FakeElement();
  const saved: PracticeAnswer[] = [];
  const submitted: PracticeAnswer[] = [];
  renderQuizCard(dom(root), question, {
    questionId: "q-1", active: true, onHint: () => {},
    onDraft: value => saved.push(value),
    onSubmit: async value => { submitted.push(value); return true; },
  });
  const radios = root.findAll("input");
  assert.equal(radios.length, 2);
  radios[1].checked = true;
  radios[1].trigger("change");
  assert.deepEqual(saved[0], { type: "multiple-choice", optionId: "b" });
  const submit = root.findClass("nox-quiz-submit")!;
  assert.equal(submit.disabled, false);
  submit.trigger("click");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(submitted, [{ type: "multiple-choice", optionId: "b" }]);
  assert.equal(submit.disabled, true);
  assert.equal(radios[0].disabled, true);
});

test("answered card is read-only and cannot submit again", () => {
  const root = new FakeElement();
  let submitted = 0;
  renderQuizCard(dom(root), question, {
    questionId: "q-1", active: false, draft: { type: "multiple-choice", optionId: "b" },
    onDraft: () => {}, onHint: () => {},
    onSubmit: async () => { submitted++; return true; },
  });
  const submit = root.findClass("nox-quiz-submit")!;
  assert.equal(submit.disabled, true);
  assert.equal(root.findAll("input").every(input => input.disabled), true);
  assert.equal(submitted, 0);
});

test("essay and code use stored draft, never execute any program", () => {
  for (const input of [
    { type: "essay" as const, criteria: ["mechanism"] },
    { type: "code" as const, language: "java", executionMode: "review-only" as const,
      starterCode: "class A {}" },
  ]) {
    const root = new FakeElement();
    const draft: PracticeAnswer = input.type === "essay"
      ? { type: "essay", text: "Some explanation" }
      : { type: "code", language: "java", source: "class B {}" };
    renderQuizCard(dom(root), { kind: "question", question: "Answer?", concept: "learning",
      input }, { questionId: "q", active: true, draft, onDraft: () => {},
      onHint: () => {}, onSubmit: async () => true });
    assert.equal(root.findAll("textarea").length, 1);
    assert.equal(root.findAll("textarea")[0].value,
      draft.type === "essay" ? draft.text : draft.source);
  }
});
