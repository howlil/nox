import type { PracticeAnswer, PracticeQuestion } from "../domain/practice/types";
import { validatePracticeAnswer } from "../domain/practice/question-schema";

export interface QuizCardActions {
  questionId: string;
  active: boolean;
  draft?: PracticeAnswer;
  onDraft: (answer: PracticeAnswer) => void;
  onSubmit: (answer: PracticeAnswer) => Promise<boolean>;
  onHint: () => void;
}

/**
 * One in-thread answer surface. This component never talks to providers,
 * storage, or the vault. All durable actions flow through LearningController.
 */
export function renderQuizCard(parent: HTMLElement, question: PracticeQuestion,
  actions: QuizCardActions): void {
  const card = parent.createDiv({ cls: "nox-quiz-card" });
  card.createDiv({ cls: "nox-practice-label",
    text: "Practice · " + question.concept });
  card.createDiv({ cls: "nox-practice-question", text: question.question });
  if (!question.input) return;
  const input = question.input;
  const disabled = !actions.active || !actions.questionId;
  const answerArea = card.createDiv({ cls: "nox-quiz-answer" });
  const status = card.createDiv({ cls: "nox-quiz-status", attr: { "aria-live": "polite" } });
  let answer: PracticeAnswer | undefined;
  let submit!: HTMLButtonElement;

  const update = (value: PracticeAnswer) => {
    answer = value;
    if (submit) submit.disabled = disabled || !isValid();
    if (!disabled) actions.onDraft(value);
    status.setText("");
  };
  const isValid = () => {
    if (!answer) return false;
    try { validatePracticeAnswer(question, answer); return true; }
    catch { return false; }
  };

  if (input.type === "multiple-choice") {
    const group = answerArea.createDiv({ cls: "nox-quiz-options", attr: { role: "radiogroup",
      "aria-label": "Choose an answer" } });
    const selected = actions.draft?.type === "multiple-choice"
      ? actions.draft.optionId : undefined;
    for (const [index, option] of input.options.entries()) {
      const row = group.createEl("label", { cls: "nox-quiz-option" });
      const radio = row.createEl("input", { type: "radio" });
      radio.name = "nox-question-" + actions.questionId;
      radio.value = option.id;
      radio.checked = selected === option.id;
      radio.disabled = disabled;
      row.createSpan({ cls: "nox-quiz-option-key", text: String.fromCharCode(65 + index) });
      row.createSpan({ text: option.text });
      radio.addEventListener("change", () => {
        if (radio.checked) update({ type: "multiple-choice", optionId: option.id });
      });
    }
    if (selected) answer = { type: "multiple-choice", optionId: selected };
  } else if (input.type === "essay") {
    const editor = answerArea.createEl("textarea", { cls: "nox-quiz-editor" });
    editor.rows = 5;
    editor.placeholder = "Write your answer...";
    editor.setAttribute("aria-label", "Essay answer");
    editor.disabled = disabled;
    editor.value = actions.draft?.type === "essay" ? actions.draft.text : "";
    if (editor.value.trim()) answer = { type: "essay", text: editor.value };
    editor.addEventListener("input", () => update({ type: "essay", text: editor.value }));
  } else {
    const toolbar = answerArea.createDiv({ cls: "nox-quiz-code-meta" });
    toolbar.createSpan({ text: input.language });
    toolbar.createSpan({ text: "Review only · not executed" });
    const editor = answerArea.createEl("textarea", { cls: "nox-quiz-editor nox-quiz-code-editor" });
    editor.rows = 9;
    editor.spellcheck = false;
    editor.setAttribute("aria-label", "Code answer");
    editor.disabled = disabled;
    editor.value = actions.draft?.type === "code" &&
      actions.draft.language === input.language
      ? actions.draft.source : input.starterCode ?? "";
    if (editor.value.trim()) answer = { type: "code", language: input.language, source: editor.value };
    editor.addEventListener("input", () => update({
      type: "code", language: input.language, source: editor.value,
    }));
    editor.addEventListener("keydown", event => {
      if (event.key !== "Tab" || event.shiftKey) return;
      event.preventDefault();
      const start = editor.selectionStart, end = editor.selectionEnd;
      editor.setRangeText("  ", start, end, "end");
      update({ type: "code", language: input.language, source: editor.value });
    });
  }

  const footer = card.createDiv({ cls: "nox-quiz-actions" });
  if (question.hint && actions.active) {
    const hint = footer.createEl("button", { cls: "nox-quiz-hint", text: "Hint" });
    hint.type = "button";
    hint.addEventListener("click", actions.onHint);
  }
  submit = footer.createEl("button", { cls: "nox-quiz-submit",
    text: disabled ? "Answered" : "Submit answer" });
  submit.type = "button";
  submit.disabled = disabled || !isValid();
  submit.addEventListener("click", async () => {
    if (!answer || !isValid() || submit.disabled) return;
    submit.disabled = true;
    status.setText("Submitting...");
    let committed = false;
    try {
      committed = await actions.onSubmit(answer);
      if (committed) {
        status.setText("Answer recorded.");
        submit.setText("Answered");
        card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")
          .forEach(control => { control.disabled = true; });
      } else {
        status.setText("The answer was not evaluated. You can retry.");
      }
    } catch (error) {
      status.setText(error instanceof Error ? error.message : "Unable to submit the answer.");
    } finally {
      if (actions.active && !committed) submit.disabled = !isValid();
    }
  });
}
