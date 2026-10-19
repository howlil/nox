import assert from "node:assert/strict";
import test from "node:test";
import { parseNoxQuiz, scoreNoxQuiz } from "../../src/chat/response-quiz";
import { renderNoxQuiz } from "../../src/chat/response-quiz-render";
import { visualKindFromClasses, MAX_VISUAL_SOURCE_CHARS } from "../../src/chat/response-spec";

const sample = {
  version: 1, kind: "quiz", title: "Backend Engineering",
  questions: [
    { id: "q1", question: "What does idempotency guarantee?",
      description: "Consider repeated requests.", options: [
        { id: "a", text: "Request is always faster" },
        { id: "b", text: "Repeating a request has no extra intended effect" },
      ], correctOptionId: "b", explanation: "Same intended effect under retries." },
    { id: "q2", question: "Which component caches results?",
      options: [{ id: "a", text: "Redis" }, { id: "b", text: "Load balancer" }],
      correctOptionId: "a" },
  ],
};
const parse = (value: unknown) => parseNoxQuiz(JSON.stringify(value));

test("nox-quiz fence is opt-in and validated independently of learning-practice", () => {
  assert.equal(visualKindFromClasses(["language-nox-quiz"]), "nox-quiz");
  assert.equal(visualKindFromClasses(["language-learning-practice"]), null);
  assert.equal(visualKindFromClasses(["language-json"]), null);
  assert.deepEqual(parse(sample), sample);
});

test("quiz validation rejects malformed, duplicate, oversized and adversarial inputs", () => {
  assert.equal(parse({ ...sample, version: 2 }), null);
  assert.equal(parse({ ...sample, kind: "learning-practice" }), null);
  assert.equal(parse({ ...sample, questions: [] }), null);
  assert.equal(parse({ ...sample, title: "x".repeat(121) }), null);
  assert.equal(parse({ ...sample, questions: [sample.questions[0], sample.questions[0]] }), null);
  assert.equal(parse({ ...sample, questions: [{ ...sample.questions[0], correctOptionId: "missing" }] }), null);
  assert.equal(parse({ ...sample, questions: [{ ...sample.questions[0], options: [
    { id: "a", text: "One" }, { id: "a", text: "Two" },
  ] }] }), null);
  assert.equal(parse({ ...sample, questions: [{ ...sample.questions[0], question: "" }] }), null);
  assert.equal(parse({ ...sample, questions: [{ ...sample.questions[0], question: "x".repeat(501) }] }), null);
  assert.equal(parse({ ...sample, questions: Array.from({length: 51}, (_, i) => ({
    ...sample.questions[0], id: "q" + i,
  })) }), null);
  assert.equal(parseNoxQuiz("not json"), null);
  assert.equal(parseNoxQuiz("x".repeat(MAX_VISUAL_SOURCE_CHARS + 1)), null);
});

test("quiz preserves literal markup as text only; no HTML evaluation or scripts", () => {
  const scriptLike = { ...sample, questions: [
    { ...sample.questions[0], question: '<img src=x onerror=alert(1)>', options: [
      { id: "a", text: "<script>alert(1)</script>" }, { id: "b", text: "Safe answer" },
    ] },
  ] };
  assert.equal(parse(scriptLike)?.questions[0].question, '<img src=x onerror=alert(1)>');
});

test("score counts correct, wrong and skipped answers without mutating question source", () => {
  const spec = parse(sample);
  assert.ok(spec);
  const answers = new Map([["q1", "b"]]);
  assert.deepEqual(scoreNoxQuiz(spec, answers), {
    answered: 1, correct: 1, incorrect: 0, skipped: 1, graded: 1, pendingReview: 0,
  });
  answers.set("q2", "b");
  assert.deepEqual(scoreNoxQuiz(spec, answers), {
    answered: 2, correct: 1, incorrect: 1, skipped: 0, graded: 2, pendingReview: 0,
  });
  assert.equal(spec.questions[0].correctOptionId, "b");
});

type Handler = () => void;
class FakeElement {
  className = "";
  value = "";
  rows = 0;
  spellcheck = true;
  scrollHeight = 100;
  removed = false;
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  handlers = new Map<string, Handler[]>();
  disabled = false;
  tabIndex = 0;
  type = "";
  style: { width?: string; height?: string } = {};
  wasFocused = false;
  private value = "";
  constructor(public tag: string) {}
  createDiv(options: { cls?: string } = {}): FakeElement {
    const child = new FakeElement("div");
    child.className = options.cls ?? "";
    this.append(child);
    return child;
  }
  createEl(tag: string, options: { cls?: string } = {}): FakeElement {
    const child = new FakeElement(tag);
    child.className = options.cls ?? "";
    this.append(child);
    return child;
  }
  remove() { this.removed = true; }
  set textContent(value: string) { this.value = value; this.children = []; }
  get textContent(): string { return this.value + this.children.map(child => child.textContent).join(""); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: FakeElement[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: FakeElement[]) { this.value = ""; this.children = [...nodes]; }
  empty() { this.replaceChildren(); }
  focus() { this.wasFocused = true; }
  addEventListener(name: string, handler: Handler) {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
  }
  click() {
    if (this.disabled) return;
    for (const handler of this.handlers.get("click") ?? []) handler();
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): FakeElement[] {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    const tag = className ? "" : selector.toLowerCase();
    const result: FakeElement[] = [];
    for (const child of this.children) {
      if ((className && child.className.split(" ").includes(className)) ||
          (tag && child.tag === tag)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
}

test("native quiz renders only active question, remembers choices, navigates and restarts", () => {
  const spec = parse(sample);
  assert.ok(spec);
  const fakeDoc = {
    createElement: (tag: string) => new FakeElement(tag),
  } as unknown as Document;
  const root = renderNoxQuiz(spec, fakeDoc) as unknown as FakeElement;
  const stage = root.querySelector(".nox-quiz-stage");
  const actions = root.querySelectorAll(".nox-quiz-button");
  assert.ok(stage);
  assert.equal(actions.length, 2);
  const [previous, next] = actions;
  assert.match(stage.textContent, /What does idempotency guarantee/);
  assert.doesNotMatch(stage.textContent, /Which component caches results/);
  const firstOptions = stage.querySelectorAll(".nox-quiz-option");
  firstOptions[1].click();
  assert.equal(firstOptions[1].getAttribute("aria-pressed"), "true");
  next.click();
  assert.match(stage.textContent, /Which component caches results/);
  assert.doesNotMatch(stage.textContent, /What does idempotency guarantee/);
  assert.equal(stage.querySelectorAll(".nox-quiz-option").length, 2);
  previous.click();
  assert.equal(stage.querySelectorAll(".nox-quiz-option")[1].getAttribute("aria-pressed"), "true");
  next.click();
  // Leaving question two blank is permitted, but scored as skipped.
  next.click();
  assert.match(stage.textContent, /Quiz results/);
  assert.match(stage.textContent, /1 \/ 2/);
  assert.equal(root.querySelector(".nox-quiz-review")?.tag, "details");
  previous.click();
  assert.match(stage.textContent, /What does idempotency guarantee/);
  assert.equal(stage.querySelectorAll(".nox-quiz-option")[1].getAttribute("aria-pressed"), "true");
  next.click();
  next.click();
  next.click(); // restart
  assert.match(stage.textContent, /What does idempotency guarantee/);
  assert.equal(stage.querySelectorAll(".nox-quiz-option")[1].getAttribute("aria-pressed"), "false");
  assert.match(root.querySelector(".nox-quiz-answered")?.textContent ?? "", /0 of 2 answered/);
});


const mixed = {
  version: 1, kind: "quiz", title: "Java and APIs",
  questions: [
    sample.questions[0],
    { id: "coding", type: "code", question: "Implement a counter.",
      description: "Use a field and return the current value.",
      language: "java",
      starterCode: "class Counter {\n  // TODO\n}",
      criteria: ["Store the state", "Return the incremented count"],
      executionMode: "review-only" },
    sample.questions[1],
  ],
};

test("M2 parser accepts mixed/only-code quizzes and rejects unsafe code shapes", () => {
  const spec = parse(mixed);
  assert.ok(spec);
  assert.equal(spec.questions[1].type, "code");
  assert.equal(parse({ ...mixed, questions: [mixed.questions[1]] })?.questions.length, 1);
  const code = mixed.questions[1];
  assert.equal(parse({ ...mixed, questions: [{ ...code, executionMode: "execute" }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, options: [{ id: "a", text: "bad" }] }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, correctOptionId: "a" }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, language: "" }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, language: "j".repeat(41) }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, starterCode: "x".repeat(12_001) }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, criteria: [""] }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, criteria: Array(13).fill("x") }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, explanation: "fake verified" }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...code, type: "essay" }] }), null);
  assert.equal(parse({ ...mixed, questions: [{ ...sample.questions[0], type: "multiple-choice" }] })?.questions[0].type,
    "multiple-choice");
});

test("M2 grading excludes code answers and counts only modified nonempty code drafts", () => {
  const spec = parse(mixed);
  assert.ok(spec);
  const answer = new Map([["q1", "b"], ["coding", "class Counter {\n  // TODO\n}"]]);
  assert.deepEqual(scoreNoxQuiz(spec, answer), {
    answered: 1, correct: 1, incorrect: 0, skipped: 2, graded: 1, pendingReview: 0,
  });
  answer.set("coding", "");
  assert.equal(scoreNoxQuiz(spec, answer).answered, 1);
  answer.set("coding", "class Counter { int value = 1; }");
  assert.deepEqual(scoreNoxQuiz(spec, answer), {
    answered: 2, correct: 1, incorrect: 0, skipped: 1, graded: 1, pendingReview: 1,
  });
  answer.set("q2", "b");
  assert.deepEqual(scoreNoxQuiz(spec, answer), {
    answered: 3, correct: 1, incorrect: 1, skipped: 0, graded: 2, pendingReview: 1,
  });
});

test("M2 code view shares auto-height input, preserves edits/empty draft and never scores code", () => {
  const spec = parse(mixed);
  assert.ok(spec);
  const doc = { createElement: (tag: string) => new FakeElement(tag) } as unknown as Document;
  const root = renderNoxQuiz(spec, doc) as unknown as FakeElement;
  const stage = root.querySelector(".nox-quiz-stage")!;
  const [previous, next] = root.querySelectorAll(".nox-quiz-button");
  stage.querySelectorAll(".nox-quiz-option")[1].click();
  next.click();
  assert.match(stage.textContent, /Implement a counter/);
  assert.doesNotMatch(stage.textContent, /Which component caches results/);
  const source = stage.querySelector(".nox-quiz-code-input")?.querySelector("textarea");
  assert.ok(source, "fake DOM host falls back to real editable textarea");
  assert.equal(source.value, "class Counter {\n  // TODO\n}");
  assert.equal(source.rows, 3, "M1 shared editor provides dynamic-height baseline");
  source.value = "class Counter { int current = 42; }";
  source.click(); // no input listener here
  for (const handler of source.handlers.get("input") ?? []) handler();
  assert.match(root.querySelector(".nox-quiz-answered")?.textContent ?? "", /2 of 3 answered/);
  next.click();
  assert.equal(source.removed, true, "old code editor must be destroyed on Next");
  previous.click();
  const restored = stage.querySelector(".nox-quiz-code-input")?.querySelector("textarea");
  assert.ok(restored);
  assert.equal(restored.value, "class Counter { int current = 42; }");
  restored.value = "";
  for (const handler of restored.handlers.get("input") ?? []) handler();
  next.click();
  previous.click();
  assert.equal(stage.querySelector("textarea")?.value, "",
    "empty code draft must not restore scaffold");
  const current = stage.querySelector("textarea")!;
  current.value = "return new Counter();";
  for (const handler of current.handlers.get("input") ?? []) handler();
  next.click();
  next.click();
  assert.match(stage.textContent, /Quiz results/);
  assert.match(stage.textContent, /1 \/ 2/);
  assert.match(stage.textContent, /Coding responses have not been executed, reviewed, or graded/);
  assert.match(stage.textContent, /1Code awaiting review/);
  assert.doesNotMatch(stage.textContent, /2 \/ 3/);
  const codeReview = stage.querySelector(".nox-quiz-submitted-code");
  assert.ok(codeReview);
  assert.equal(codeReview.textContent, "return new Counter();");
  previous.click();
  next.click();
  next.click();
  next.click(); // result screen
  next.click(); // restart
  next.click(); // coding question
  assert.equal(stage.querySelector("textarea")?.value, "class Counter {\n  // TODO\n}",
    "restart resets code to original scaffold");
  assert.match(root.querySelector(".nox-quiz-answered")?.textContent ?? "", /0 of 3 answered/);
});

test("M2 all-code quiz reports no graded questions, even if code was entered", () => {
  const spec = parse({ ...mixed, questions: [mixed.questions[1]] });
  assert.ok(spec);
  const doc = { createElement: (tag: string) => new FakeElement(tag) } as unknown as Document;
  const root = renderNoxQuiz(spec, doc) as unknown as FakeElement;
  const stage = root.querySelector(".nox-quiz-stage")!;
  const textarea = stage.querySelector("textarea")!;
  textarea.value = "class Counter { int value; }";
  for (const handler of textarea.handlers.get("input") ?? []) handler();
  root.querySelectorAll(".nox-quiz-button")[1].click();
  assert.match(stage.textContent, /No automatically graded questions/);
  assert.match(stage.textContent, /Coding responses have not been executed, reviewed, or graded/);
  assert.doesNotMatch(stage.textContent, /1 \/ 1/);
});
