/** Read-only, model-generated quiz content. Not part of the native Practice engine. */
import { MAX_VISUAL_SOURCE_CHARS } from "./response-spec";

/** Legacy MCQs omitted type; preserve that shape on decode and transcript recovery. */
export interface NoxQuizChoice {
  id: string;
  type?: "multiple-choice";
  question: string;
  description?: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanation?: string;
}

export interface NoxQuizCode {
  id: string;
  type: "code";
  question: string;
  description?: string;
  language: string;
  starterCode?: string;
  criteria?: string[];
  executionMode: "review-only";
}

export type NoxQuizQuestion = NoxQuizChoice | NoxQuizCode;

export interface NoxQuizSpec {
  version: 1;
  kind: "quiz";
  title: string;
  questions: NoxQuizQuestion[];
}

export type NoxQuizAnswers = ReadonlyMap<string, string>;

const ID = /^[a-zA-Z0-9_-]{1,40}$/;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const bounded = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Decode only a restricted known variant, not executable code or new learning state. */
export function parseNoxQuiz(raw: string): NoxQuizSpec | null {
  if (!raw.trim() || raw.length > MAX_VISUAL_SOURCE_CHARS) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!record(value) || value.version !== 1 || value.kind !== "quiz" ||
      !bounded(value.title, 120) || !Array.isArray(value.questions) ||
      value.questions.length < 1 || value.questions.length > 50) return null;

  const questionIds = new Set<string>();
  const questions: NoxQuizQuestion[] = [];
  for (const input of value.questions) {
    if (!record(input) || typeof input.id !== "string" || !ID.test(input.id) ||
        questionIds.has(input.id) || !bounded(input.question, 500) ||
        (input.description !== undefined && !bounded(input.description, 600))) return null;
    questionIds.add(input.id);
    const shared = {
      id: input.id, question: input.question,
      ...(typeof input.description === "string" ? { description: input.description } : {}),
    };

    if (input.type === "code") {
      if (!bounded(input.language, 40) ||
          input.executionMode !== "review-only" ||
          (input.starterCode !== undefined &&
            (typeof input.starterCode !== "string" || input.starterCode.length > 12_000)) ||
          (input.criteria !== undefined && (!Array.isArray(input.criteria) ||
            input.criteria.length > 12 ||
            !input.criteria.every(item => bounded(item, 500)))) ||
          input.options !== undefined || input.correctOptionId !== undefined ||
          input.explanation !== undefined) return null;
      questions.push({
        ...shared, type: "code", language: input.language,
        executionMode: "review-only",
        ...(typeof input.starterCode === "string" ? { starterCode: input.starterCode } : {}),
        ...(Array.isArray(input.criteria) ? { criteria: input.criteria as string[] } : {}),
      });
      continue;
    }

    if (input.type !== undefined && input.type !== "multiple-choice") return null;
    if (!Array.isArray(input.options) || input.options.length < 2 ||
        input.options.length > 6 || typeof input.correctOptionId !== "string" ||
        (input.explanation !== undefined && !bounded(input.explanation, 600)) ||
        input.starterCode !== undefined || input.language !== undefined ||
        input.criteria !== undefined || input.executionMode !== undefined) return null;
    const optionIds = new Set<string>();
    const options: NoxQuizChoice["options"] = [];
    for (const option of input.options) {
      if (!record(option) || typeof option.id !== "string" || !ID.test(option.id) ||
          optionIds.has(option.id) || !bounded(option.text, 280)) return null;
      optionIds.add(option.id);
      options.push({ id: option.id, text: option.text });
    }
    if (!optionIds.has(input.correctOptionId)) return null;
    questions.push({
      ...shared,
      ...(input.type === "multiple-choice" ? { type: "multiple-choice" as const } : {}),
      options, correctOptionId: input.correctOptionId,
      ...(typeof input.explanation === "string" ? { explanation: input.explanation } : {}),
    });
  }
  return { version: 1, kind: "quiz", title: value.title, questions };
}

export interface NoxQuizScore {
  answered: number;
  correct: number;
  incorrect: number;
  skipped: number;
  /** How many MCQs were scored. Coding work must NOT increase this count. */
  graded: number;
  /** Coding responses that must receive a separate evaluation, not correctness. */
  pendingReview: number;
}

/** Deterministic MCQ-only self-check; coding answer count does not imply grading. */
export function scoreNoxQuiz(spec: NoxQuizSpec, selections: NoxQuizAnswers): NoxQuizScore {
  let answered = 0, correct = 0, graded = 0, pendingReview = 0;
  for (const q of spec.questions) {
    const selected = selections.get(q.id);
    if (q.type === "code") {
      // An untouched generated scaffold is not a submitted solution.
      if (selected?.trim() && selected !== (q.starterCode ?? "")) {
        answered++;
        pendingReview++;
      }
      continue;
    }
    if (selected === undefined) continue;
    if (!q.options.some(option => option.id === selected)) continue;
    answered++;
    graded++;
    if (selected === q.correctOptionId) correct++;
  }
  return {
    answered, correct, graded,
    incorrect: graded - correct,
    skipped: spec.questions.length - answered,
    pendingReview,
  };
}
