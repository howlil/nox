import assert from "node:assert/strict";
import test from "node:test";
import { renderPracticeInstructions, legacyInstructionParagraphs } from "../../src/features/practice/view/practice-instructions";
import { renderQuizCard } from "../../src/features/practice/view/quiz-card";
import type { PracticeQuestion } from "../../src/domain/practice/types";
import { isPracticeQuestion } from "../../src/domain/practice/question-schema";

class FakeElement {
  children: FakeElement[] = [];
  value = "";
  disabled = false;
  rows = 0;
  placeholder = "";
  spellcheck = true;
  type = "";
  textContent = "";
  constructor(public tag = "div", public cls = "", public text = "") {}
  createDiv(o: { cls?: string; text?: string } = {}) {
    const element = new FakeElement("div", o.cls, o.text);
    this.children.push(element); return element;
  }
  createSpan(o: { cls?: string; text?: string } = {}) {
    const element = new FakeElement("span", o.cls, o.text);
    this.children.push(element); return element;
  }
  createEl(tag: string, o: { cls?: string; text?: string; type?: string } = {}) {
    const element = new FakeElement(tag, o.cls, o.text);
    element.type = o.type || "";
    this.children.push(element); return element;
  }
  setAttribute(_key: string, _value: string) {}
  addEventListener(_event: string, _handler: () => void) {}
  setText(value: string) { this.text = value; }
  querySelectorAll<T>(_selector: string): T[] { return []; }
  findAll(tag: string): FakeElement[] {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap(x => x.findAll(tag))];
  }
  findClass(cls: string): FakeElement | undefined {
    return this.cls.split(/\s+/).includes(cls) ? this :
      this.children.map(x => x.findClass(cls)).find(Boolean);
  }
  allText(): string { return this.text + this.children.map(x => x.allText()).join(""); }
}
const asDOM = (x: FakeElement) => x as unknown as HTMLElement;
const codeTick = String.fromCharCode(96);
const structured: PracticeQuestion = {
  kind: "question",
  concept: "REST Controllers",
  question: "Build a REST controller for Book.",
  instructions: {
    title: "Build a REST Controller for Book",
    brief: "Implement the endpoints with the supplied BookService.",
    tasks: ["Create GET /books", "Handle GET /books/{id}", "Implement POST /books"],
    requirements: ["Use " + codeTick + "@RequestBody" + codeTick, "Return ResponseEntity"],
    given: ["Book has id, title and author", "BookService already exists"],
    expectedOutput: ["One controller class"],
    referenceCode: "public interface BookService {\n  Book findById(Long id);\n}",
  },
  input: { type: "code", language: "java", executionMode: "review-only",
    starterCode: "@RestController\npublic class BookController {\n}" },
};

test("structured instruction contract accepts bounded sections without changing question identity", () => {
  assert.equal(isPracticeQuestion(structured), true);
  assert.equal(isPracticeQuestion({ ...structured, instructions: {
    ...structured.instructions, tasks: Array.from({ length: 13 }, () => "Too many"),
  } }), false);
  assert.equal(isPracticeQuestion({ ...structured, instructions: {
    ...structured.instructions, referenceCode: "x".repeat(12001),
  } }), false);
  assert.equal(isPracticeQuestion({ ...structured, instructions: {
    ...structured.instructions, title: "",
  } }), false);
});

test("structured rendering puts readable tasks and requirements before a collapsed reference", () => {
  const root = new FakeElement();
  renderPracticeInstructions(asDOM(root), structured);
  assert.equal(root.findAll("h3")[0]?.allText(), "Build a REST Controller for Book");
  const sections = root.findAll("ol");
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].findAll("li").map(x => x.allText()),
    ["Create GET /books", "Handle GET /books/{id}", "Implement POST /books"]);
  assert.equal(root.findAll("ul").length, 3);
  assert.equal(root.findAll("summary")[0]?.text, "Given code · View reference");
  assert.equal(root.findAll("pre")[0]?.allText(), structured.instructions?.referenceCode);
  assert.equal(root.findAll("code").some(x => x.text === "@RequestBody"), true);
});

test("existing long Indonesian exercise remains complete and is split only at sentence boundaries", () => {
  const original = "Tulis sebuah Spring REST controller dengan Book. " +
    "Gunakan @PathVariable untuk ID. Bungkus response dengan ResponseEntity. " +
    "Anggap BookService sudah tersedia.";
  const legacy: PracticeQuestion = { kind: "question", concept: "Spring", question: original };
  const paragraphs = legacyInstructionParagraphs(original);
  assert.equal(paragraphs.length, 4);
  assert.equal(paragraphs.join(" "), original);
  const root = new FakeElement();
  renderPracticeInstructions(asDOM(root), legacy);
  assert.equal(root.findAll("h3").length, 0);
  assert.equal(root.findAll("p").length, 4);
  assert.equal(root.findAll("p").map(x => x.allText()).join(" "), original);
  assert.equal(root.findAll("ol").length, 0); // Never invent tasks from unstructured input.
});

test("context reference code is separate from learner starter code; never auto-executed", () => {
  const root = new FakeElement();
  renderQuizCard(asDOM(root), structured, {
    questionId: "q-1", active: true,
    onDraft: () => {}, onSubmit: async () => true, onHint: () => {},
  });
  const editor = root.findAll("textarea")[0];
  assert.ok(editor);
  assert.equal(editor.value, structured.input?.type === "code" ? structured.input.starterCode : "");
  assert.doesNotMatch(editor.value, /findById/);
  assert.match(root.findAll("pre")[0]?.allText() ?? "", /findById/);
  assert.equal(root.findAll("details").length, 1);
});

test("HTML-looking model text remains plain text and does not create arbitrary DOM tags", () => {
  const root = new FakeElement();
  renderPracticeInstructions(asDOM(root), { ...structured,
    instructions: { title: "<img src=x onerror=evil()>",
      tasks: ["Never execute <script>window.evil()</script>"] } });
  assert.equal(root.findAll("img").length, 0);
  assert.equal(root.findAll("script").length, 0);
  assert.match(root.allText(), /<img src=x/);
});
