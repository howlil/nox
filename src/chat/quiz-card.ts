import type { PracticeAnswer, PracticeQuestion } from "../domain/practice/types";
import { validatePracticeAnswer } from "../domain/practice/question-schema";
import { renderPracticeInstructions } from "./practice-instructions";
import { createNoxButton, createNoxSurface } from "./primitives";

export interface QuizCardActions {
  questionId: string;
  active: boolean;
  draft?: PracticeAnswer;
  /** Derived from the persisted /hint turn, never a second durable state. */
  hintUsed?: boolean;
  onDraft: (answer: PracticeAnswer) => void;
  onSubmit: (answer: PracticeAnswer) => Promise<boolean>;
  /** Resolve true only after the canonical /hint operation has been persisted. */
  onHint: () => Promise<boolean> | boolean | void;
  onClarify?: () => void;
}

/**
 * One in-thread answer surface. This component never talks to providers,
 * storage, or the vault. All durable actions flow through LearningController.
 */
export function renderQuizCard(parent: HTMLElement, question: PracticeQuestion,
  actions: QuizCardActions): void {
  const card = createNoxSurface(parent, "nox-quiz-card");
  const header = card.createDiv({ cls: "nox-quiz-heading" });
  header.createDiv({ cls: "nox-practice-label", text: "Practice · " + question.concept });
  header.createSpan({ cls: "nox-quiz-kind", text: question.input?.type === "code"
    ? "Code challenge" : question.input?.type === "multiple-choice"
      ? "Multiple choice" : "Written answer" });
  renderPracticeInstructions(card, question);
  // Legacy practice questions render as interactive essay cards too.
  const input = question.input ?? { type: "essay" as const };
  const disabled = !actions.active || !actions.questionId;
  const answerArea = card.createDiv({ cls: "nox-quiz-answer" });
  answerArea.createDiv({ cls: "nox-quiz-editor-label", text: input.type === "code"
    ? "Your solution" : "Your answer" });
  const status = card.createDiv({ cls: "nox-quiz-status", attr: { "aria-live": "polite" } });
  let answer: PracticeAnswer | undefined;
  let submit!: HTMLButtonElement;
  let busy = false;
  let hintPending = false;
  let syncOptionState = () => {};

  const update = (value: PracticeAnswer) => {
    answer = value;
    if (submit) submit.disabled = disabled || busy || !isValid();
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
    // Explicit state classes avoid expensive :has() invalidation in a dense view.
    const optionControls: Array<{ row: HTMLElement; radio: HTMLInputElement }> = [];
    const refreshOptionStates = () => {
      for (const { row, radio } of optionControls) {
        row.className = "nox-quiz-option" + (radio.checked ? " is-checked" : "") +
          (radio.disabled ? " is-disabled" : "");
      }
    };
    syncOptionState = refreshOptionStates;
    for (const [index, option] of input.options.entries()) {
      const row = group.createEl("label", { cls: "nox-quiz-option" });
      const radio = row.createEl("input", { type: "radio" });
      radio.name = "nox-question-" + actions.questionId;
      radio.value = option.id;
      radio.checked = selected === option.id;
      radio.disabled = disabled;
      optionControls.push({ row, radio });
      row.createSpan({ cls: "nox-quiz-option-key", text: String.fromCharCode(65 + index) });
      row.createSpan({ text: option.text });
      radio.addEventListener("change", () => {
        refreshOptionStates();
        if (radio.checked) update({ type: "multiple-choice", optionId: option.id });
      });
    }
    refreshOptionStates();
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
    toolbar.createSpan({ text: "Review only · Tab moves focus" });
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
  }

  // The hint body is intentionally absent from the visible UI until the
  // persisted /hint command confirms assisted practice. It is not an answer key.
  const hintPanel = question.hint
    ? card.createDiv({ cls: "nox-quiz-hint-panel" }) : null;
  if (hintPanel) {
    hintPanel.hidden = true;
    hintPanel.createDiv({ cls: "nox-quiz-hint-title", text: "A small nudge" });
    hintPanel.createDiv({ cls: "nox-quiz-hint-text", text: question.hint });
    hintPanel.createDiv({ cls: "nox-quiz-hint-note",
      text: "Using a hint makes this attempt assisted, not independent recall." });
  }

  const footer = card.createDiv({ cls: "nox-quiz-actions" });
  let hintUsed = Boolean(actions.hintUsed);
  let hintVisible = false;
  let hintButton: HTMLButtonElement | null = null;
  if (hintPanel && actions.active) {
    hintButton = createNoxButton(footer, {
      cls: "nox-quiz-hint", variant: "quiet",
      text: hintUsed ? "Show hint" : "Get hint",
      label: hintUsed ? "Show the previously requested hint" : "Request a hint; this marks the answer assisted",
    });
    const hintControl = hintButton;
    const hintId = "nox-hint-" + actions.questionId;
    hintPanel.id = hintId;
    hintControl.setAttribute("aria-controls", hintId);
    hintControl.setAttribute("aria-expanded", "false");
    hintControl.addEventListener("click", () => { void (async () => {
      if (disabled || busy || hintPending) return;
      if (!hintUsed) {
        hintPending = true;
        hintControl.disabled = true;
        hintControl.setText("Opening hint…");
        try {
          if (await actions.onHint() !== true) {
            status.setText("Hint could not be saved. Try again.");
            return;
          }
          hintUsed = true;
        } catch (error) {
          status.setText(error instanceof Error ? error.message : "Unable to open hint.");
          return;
        } finally {
          hintPending = false;
          hintControl.disabled = busy;
        }
      }
      hintVisible = !hintVisible;
      hintPanel.hidden = !hintVisible;
      hintControl.setAttribute("aria-expanded", String(hintVisible));
      hintControl.setText(hintVisible ? "Hide hint" : "Show hint");
      status.setText("");
    })().catch(error => console.warn("[Nox] Quiz action failed", error)); });
  }

  if (actions.active && actions.onClarify) {
    const clarify = createNoxButton(footer, { variant: "quiet", text: "Clarify" });
    clarify.addEventListener("click", () => {
      if (!busy && !hintPending) actions.onClarify?.();
    });
  }
  submit = createNoxButton(footer, {
    cls: "nox-quiz-submit", variant: "primary",
    text: disabled ? "Evaluated" : "Submit answer",
    label: "Submit this answer for evaluation",
  });
  submit.disabled = disabled || !isValid();
  submit.addEventListener("click", () => { void (async () => {
    if (!answer || !isValid() || submit.disabled || busy || hintPending) return;
    busy = true;
    submit.disabled = true;
    if (hintButton) hintButton.disabled = true;
    submit.setText("Evaluating…");
    status.setText("Evaluating your answer…");
    let committed = false;
    try {
      committed = await actions.onSubmit(answer);
      if (committed) {
        status.setText("Evaluation saved. Feedback appears below.");
        submit.setText("Evaluated");
        card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")
          .forEach(control => { control.disabled = true; });
        syncOptionState();
      } else {
        status.setText("The answer was not evaluated. You can retry.");
      }
    } catch (error) {
      status.setText(error instanceof Error ? error.message : "Unable to submit the answer.");
    } finally {
      busy = false;
      if (!committed) {
        submit.setText("Retry evaluation");
        if (actions.active) submit.disabled = !isValid();
        if (hintButton) hintButton.disabled = disabled;
      }
    }
  })().catch(error => console.warn("[Nox] Quiz action failed", error)); });
}
