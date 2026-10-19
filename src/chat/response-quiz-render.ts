import { setNoxIcon } from "./primitives";
import type { NoxQuizSpec, NoxQuizQuestion } from "./response-quiz";
import { scoreNoxQuiz } from "./response-quiz";

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, className?: string, content?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function control(doc: Document, text: string, style: string): HTMLButtonElement {
  const button = el(doc, "button", "nox-quiz-button " + style, text);
  button.type = "button";
  return button;
}

/**
 * Deterministic, DOM-only HTML quiz view.
 * No JS/HTML/CSS from model content is ever evaluated; answers live in
 * this component's closure and never modify native Practice or persistence.
 */
export function renderNoxQuiz(spec: NoxQuizSpec, doc: Document = document): HTMLElement {
  const root = el(doc, "section", "nox-visual nox-rich-quiz");
  root.setAttribute("aria-label", spec.title + " interactive quiz");

  const header = el(doc, "div", "nox-quiz-header");
  const brand = el(doc, "div", "nox-quiz-brand");
  const logo = el(doc, "span", "nox-quiz-logo");
  setNoxIcon(logo, "asterisk");
  logo.setAttribute("aria-hidden", "true");
  brand.append(logo, el(doc, "strong", "", "NOX / Learning"));
  header.append(brand, el(doc, "span", "nox-quiz-label", "Interactive quiz"));

  const meta = el(doc, "div", "nox-quiz-meta");
  const topic = el(doc, "span", "", spec.title);
  const counter = el(doc, "span");
  meta.append(topic, counter);

  const progress = el(doc, "div", "nox-quiz-progress");
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", String(spec.questions.length));
  progress.setAttribute("aria-label", "Quiz progress");
  const fill = el(doc, "div", "nox-quiz-progress-fill");
  progress.append(fill);

  const stage = el(doc, "div", "nox-quiz-stage");
  stage.setAttribute("aria-live", "off");
  const footer = el(doc, "div", "nox-quiz-footer");
  const answered = el(doc, "span", "nox-quiz-answered");
  const actions = el(doc, "div", "nox-quiz-actions");
  const previous = control(doc, "Previous", "nox-quiz-button--secondary");
  const next = control(doc, "Next", "nox-quiz-button--primary");
  actions.append(previous, next);
  footer.append(answered, actions);
  root.append(header, meta, progress, stage, footer);

  const answers = new Map<string, string>();
  let current = 0;
  let completed = false;
  const total = spec.questions.length;
  const updateCounter = (): void => {
    const result = scoreNoxQuiz(spec, answers);
    answered.textContent = result.answered + " of " + total + " answered";
    counter.textContent = completed ? "Completed" :
      String(current + 1).padStart(2, "0") + " / " + String(total).padStart(2, "0");
    progress.setAttribute("aria-valuenow", String(completed ? total : current + 1));
    fill.style.width = ((completed ? total : current + 1) / total * 100) + "%";
  };

  function displayQuestion(focus: boolean): void {
    completed = false;
    const q: NoxQuizQuestion = spec.questions[current];
    const kicker = el(doc, "div", "nox-quiz-kicker",
      "Question " + String(current + 1).padStart(2, "0") + " · Multiple choice");
    const heading = el(doc, "h3", "nox-quiz-question", q.question);
    heading.tabIndex = -1;
    const options = el(doc, "div", "nox-quiz-options");
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", "Choose one answer");
    const optionButtons: Array<{ id: string; button: HTMLButtonElement; marker: HTMLElement }> = [];
    q.options.forEach((option, i) => {
      const button = el(doc, "button", "nox-quiz-option") as HTMLButtonElement;
      button.type = "button";
      const letter = el(doc, "span", "nox-quiz-letter", String.fromCharCode(65 + i));
      letter.setAttribute("aria-hidden", "true");
      const label = el(doc, "span", "nox-quiz-option-text", option.text);
      const marker = el(doc, "span", "nox-quiz-check", "");
      marker.setAttribute("aria-hidden", "true");
      button.append(letter, label, marker);
      button.addEventListener("click", () => {
        answers.set(q.id, option.id);
        for (const item of optionButtons) {
          const selected = item.id === option.id;
          item.button.setAttribute("aria-pressed", String(selected));
          item.marker.textContent = selected ? "✓" : "";
        }
        updateCounter();
      });
      optionButtons.push({ id: option.id, button, marker });
      options.append(button);
    });
    const currentValue = answers.get(q.id);
    for (const item of optionButtons) {
      const selected = item.id === currentValue;
      item.button.setAttribute("aria-pressed", String(selected));
      item.marker.textContent = selected ? "✓" : "";
    }
    stage.replaceChildren(kicker, heading);
    if (q.description) stage.append(el(doc, "p", "nox-quiz-description", q.description));
    stage.append(options);
    previous.disabled = current === 0;
    previous.textContent = "← Previous";
    next.textContent = current === total - 1 ? "Finish quiz →" : "Next →";
    updateCounter();
    if (focus) heading.focus();
  }

  function showResults(): void {
    completed = true;
    const result = scoreNoxQuiz(spec, answers);
    const box = el(doc, "div", "nox-quiz-results");
    const heading = el(doc, "h3", "nox-quiz-question", "Quiz results");
    heading.tabIndex = -1;
    const score = el(doc, "div", "nox-quiz-score", String(result.correct) + " / " + total);
    box.append(el(doc, "div", "nox-quiz-kicker", "Quiz finished"), heading, score);
    const stats = el(doc, "div", "nox-quiz-stats");
    for (const [label, value] of [
      ["Correct", result.correct],
      ["Incorrect", result.incorrect],
      ["Skipped", result.skipped],
    ] as const) {
      const stat = el(doc, "div", "nox-quiz-stat");
      stat.append(el(doc, "strong", "", String(value)), el(doc, "span", "", label));
      stats.append(stat);
    }
    box.append(stats);
    const details = el(doc, "details", "nox-quiz-review");
    const summary = el(doc, "summary", "", "Review questions and explanations");
    const list = el(doc, "ol", "nox-quiz-review-list");
    for (const question of spec.questions) {
      const answer = answers.get(question.id);
      const correct = question.options.find(option => option.id === question.correctOptionId)!;
      const selected = question.options.find(option => option.id === answer);
      const row = el(doc, "li", "nox-quiz-review-row");
      row.append(el(doc, "strong", "", question.question));
      row.append(el(doc, "span", "",
        answer === undefined ? "Skipped" : answer === question.correctOptionId ? "Correct" : "Incorrect"));
      row.append(el(doc, "p", "", "Your answer: " + (selected?.text ?? "Not answered")));
      row.append(el(doc, "p", "", "Correct answer: " + correct.text));
      if (question.explanation) row.append(el(doc, "p", "", question.explanation));
      list.append(row);
    }
    details.append(summary, list);
    box.append(details);
    stage.replaceChildren(box);
    previous.disabled = false;
    previous.textContent = "← Review";
    next.textContent = "Restart ↻";
    updateCounter();
    heading.focus();
  }

  previous.addEventListener("click", () => {
    if (completed) current = 0;
    else if (current > 0) current--;
    displayQuestion(true);
  });
  next.addEventListener("click", () => {
    if (completed) {
      answers.clear();
      current = 0;
      displayQuestion(true);
    } else if (current < total - 1) {
      current++;
      displayQuestion(true);
    } else {
      showResults();
    }
  });

  displayQuestion(false);
  return root;
}
