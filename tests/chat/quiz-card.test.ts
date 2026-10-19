import assert from "node:assert/strict";
import test from "node:test";
import { renderQuizCard } from "../../src/features/practice/view/quiz-card";
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

test("hint is hidden until durable /hint acknowledgement and then toggles locally", async () => {
  const root = new FakeElement();
  let resolveHint: ((saved: boolean) => void) | undefined;
  let requests = 0;
  renderQuizCard(dom(root), question, {
    questionId: "q-hint", active: true,
    onHint: () => { requests++; return new Promise<boolean>(resolve => { resolveHint = resolve; }); },
    onDraft: () => {}, onSubmit: async () => false,
  });
  const panel = root.findClass("nox-quiz-hint-panel")! as FakeElement & { hidden: boolean };
  const hint = root.findClass("nox-quiz-hint")!;
  assert.equal(panel.hidden, true);
  hint.trigger("click");
  assert.equal(requests, 1);
  assert.equal(panel.hidden, true, "never expose hint before persistence");
  resolveHint?.(true);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(panel.hidden, false);
  assert.equal(hint.text, "Hide hint");
  hint.trigger("click");
  assert.equal(panel.hidden, true);
  hint.trigger("click");
  assert.equal(panel.hidden, false);
  assert.equal(requests, 1, "repeat disclosure never re-records /hint");
});

test("hint failures are retryable and do not reveal the hint", async () => {
  const root = new FakeElement();
  let count = 0;
  renderQuizCard(dom(root), question, {
    questionId: "q-hint-fail", active: true,
    onHint: async () => ++count > 1,
    onDraft: () => {}, onSubmit: async () => false,
  });
  const panel = root.findClass("nox-quiz-hint-panel")! as FakeElement & { hidden: boolean };
  const hint = root.findClass("nox-quiz-hint")!;
  hint.trigger("click");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(panel.hidden, true);
  assert.equal(hint.disabled, false);
  hint.trigger("click");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(panel.hidden, false);
  assert.equal(count, 2);
});

test("previously persisted hint is available locally without new command", () => {
  const root = new FakeElement();
  let requests = 0;
  renderQuizCard(dom(root), question, {
    questionId: "q-restored", active: true, hintUsed: true,
    onHint: () => { requests++; return true; },
    onDraft: () => {}, onSubmit: async () => false,
  });
  root.findClass("nox-quiz-hint")?.trigger("click");
  assert.equal((root.findClass("nox-quiz-hint-panel")! as FakeElement & { hidden: boolean }).hidden, false);
  assert.equal(requests, 0);
});

test("a failed evaluation remains retryable, and code Tab is not trapped", async () => {
  const root = new FakeElement();
  let submits = 0;
  renderQuizCard(dom(root), { ...question, hint: undefined }, {
    questionId: "q-retry", active: true,
    onHint: () => false, onDraft: () => {},
    onSubmit: async () => ++submits > 1,
  });
  const radios = root.findAll("input");
  radios[0].checked = true;
  radios[0].trigger("change");
  const submit = root.findClass("nox-quiz-submit")!;
  submit.trigger("click");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(submit.disabled, false);
  assert.equal(submit.text, "Retry evaluation");
  submit.trigger("click");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(submit.disabled, true);
  assert.equal(submits, 2);

  const code = new FakeElement();
  renderQuizCard(dom(code), { kind: "question", concept: "concurrency",
    question: "Fix this race", input: { type: "code", language: "ts",
      executionMode: "review-only" } }, {
      questionId: "q-code", active: true, onHint: () => false, onDraft: () => {},
      onSubmit: async () => false,
    });
  assert.equal(code.findAll("textarea")[0].handlers.has("keydown"), false);
});


test("M1 code input preserves draft, grows by content and locks on accepted submit", async () => {
  const root = new FakeElement();
  const source = "class A {\n  int x = 1;\n}";
  const recorded: PracticeAnswer[] = [];
  const submitted: PracticeAnswer[] = [];
  renderQuizCard(dom(root), { kind: "question", concept: "Java", question: "Code?",
    input: { type: "code", language: "java", executionMode: "review-only",
      starterCode: "class A {}" } }, {
    questionId: "code-m1", active: true,
    draft: { type: "code", language: "java", source },
    onDraft: answer => recorded.push(answer),
    onSubmit: async answer => { submitted.push(answer); return true; },
    onHint: () => false,
  });
  const answer = root.findAll("textarea")[0];
  assert.equal(answer.value, source);
  assert.equal(answer.rows, 3, "fallback uses compact intrinsic editor baseline");
  answer.value = source + "\nint sum = x + 3;";
  answer.trigger("input");
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], { type: "code", language: "java", source: answer.value });
  root.findClass("nox-quiz-submit")?.trigger("click");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(submitted[0], recorded[0]);
  assert.equal(answer.disabled, true, "accepted evaluation must freeze code");
});

test("M1 failed evaluation reopens the code editor for retry", async () => {
  const root = new FakeElement();
  renderQuizCard(dom(root), { kind: "question", concept: "TS", question: "Code?",
    input: { type: "code", language: "ts", executionMode: "review-only",
      starterCode: "const x = 1;" } }, {
    questionId: "code-retry", active: true,
    onDraft: () => {}, onSubmit: async () => false, onHint: () => false,
  });
  const editor = root.findAll("textarea")[0];
  const submit = root.findClass("nox-quiz-submit")!;
  submit.trigger("click");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(editor.disabled, false);
  assert.equal(submit.disabled, false);
});
