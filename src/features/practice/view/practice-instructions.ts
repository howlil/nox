import type { PracticeQuestion } from "../../../../packages/core/src/domain/practice/types";

/** Preserve AI-authored words while making inline code identifiers scannable. */
function inlineText(parent: HTMLElement, value: string): void {
  const tokens = new RegExp(String.fromCharCode(96) + "([^" + String.fromCharCode(96) +
    "\\n]+)" + String.fromCharCode(96), "g");
  let start = 0;
  for (const match of value.matchAll(tokens)) {
    const index = match.index ?? 0;
    if (index > start) parent.createEl("span", { text: value.slice(start, index) });
    parent.createEl("code", { text: match[1] });
    start = index + match[0].length;
  }
  if (start < value.length) parent.createEl("span", { text: value.slice(start) });
}

/**
 * Original legacy wording stays intact. Line breaks are purely presentational:
 * never infer endpoints, grading criteria or requirements from a paragraph.
 */
export function legacyInstructionParagraphs(value: string): string[] {
  return value.trim().replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .flatMap(paragraph => paragraph.trim()
      .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ])/u)
      .map(sentence => sentence.trim()).filter(Boolean));
}

function section(parent: HTMLElement, heading: string, values: string[],
  ordered = false): void {
  if (!values.length) return;
  const block = parent.createDiv({ cls: "nox-quiz-instruction-section" });
  block.createDiv({ cls: "nox-quiz-section-heading", text: heading });
  const list = block.createEl(ordered ? "ol" : "ul", {
    cls: ordered ? "nox-quiz-instruction-list nox-quiz-instruction-tasks"
      : "nox-quiz-instruction-list",
  });
  for (const value of values) {
    const li = list.createEl("li");
    inlineText(li, value);
  }
}

function contextDisclosure(parent: HTMLElement, referenceCode: string): void {
  const details = parent.createEl("details", { cls: "nox-quiz-context" });
  details.createEl("summary", { text: "Given code · View reference" });
  const code = details.createEl("pre", { cls: "nox-quiz-reference-code" });
  code.createEl("code", { text: referenceCode });
}

/**
 * Display only: the full PracticeQuestion is already validated at the parser
 * and transcript boundaries. Never run, interpret, or inject HTML from it.
 */
export function renderPracticeInstructions(parent: HTMLElement, question: PracticeQuestion): void {
  const instructions = question.instructions;
  if (!instructions) {
    const block = parent.createDiv({ cls: "nox-quiz-instruction-legacy" });
    block.createDiv({ cls: "nox-quiz-section-heading", text: "Task brief" });
    for (const paragraph of legacyInstructionParagraphs(question.question)) {
      const el = block.createEl("p", { cls: "nox-quiz-instruction-paragraph nox-practice-question" });
      inlineText(el, paragraph);
    }
    return;
  }

  const title = instructions.title || question.question;
  const heading = parent.createEl("h3", { cls: "nox-quiz-instruction-title" });
  inlineText(heading, title);

  const brief = instructions.brief || (
    instructions.title && question.question.trim() !== instructions.title.trim()
      ? question.question : undefined
  );
  if (brief) {
    const summary = parent.createEl("p", { cls: "nox-quiz-instruction-brief" });
    inlineText(summary, brief);
  }

  section(parent, "Your tasks", instructions.tasks ?? [], true);
  section(parent, "Requirements", instructions.requirements ?? []);
  section(parent, "Given", instructions.given ?? []);
  section(parent, "Expected output", instructions.expectedOutput ?? []);
  if (instructions.referenceCode) contextDisclosure(parent, instructions.referenceCode);
}
