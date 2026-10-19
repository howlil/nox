/** Read-only, model-generated quiz content. Not part of the native Practice engine. */
import { MAX_VISUAL_SOURCE_CHARS } from "./response-spec";

export interface NoxQuizQuestion {
  id: string;
  question: string;
  description?: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanation?: string;
}

export interface NoxQuizSpec {
  version: 1;
  kind: "quiz";
  title: string;
  questions: NoxQuizQuestion[];
}

const ID = /^[a-zA-Z0-9_-]{1,40}$/;
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const bounded = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Decode untrusted JSON before handing any values to DOM-only rendering. */
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
        (input.description !== undefined && !bounded(input.description, 600)) ||
        (input.explanation !== undefined && !bounded(input.explanation, 600)) ||
        !Array.isArray(input.options) || input.options.length < 2 ||
        input.options.length > 6 || typeof input.correctOptionId !== "string") return null;

    const optionIds = new Set<string>();
    const options: NoxQuizQuestion["options"] = [];
    for (const option of input.options) {
      if (!record(option) || typeof option.id !== "string" || !ID.test(option.id) ||
          optionIds.has(option.id) || !bounded(option.text, 280)) return null;
      optionIds.add(option.id);
      options.push({ id: option.id, text: option.text });
    }
    if (!optionIds.has(input.correctOptionId)) return null;
    questionIds.add(input.id);
    questions.push({
      id: input.id, question: input.question, options,
      correctOptionId: input.correctOptionId,
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      ...(typeof input.explanation === "string" ? { explanation: input.explanation } : {}),
    });
  }
  return { version: 1, kind: "quiz", title: value.title, questions };
}

/** Derived result only: local formative scoring, never canonical learning evidence. */
export function scoreNoxQuiz(spec: NoxQuizSpec, selections: ReadonlyMap<string, string>): {
  answered: number; correct: number; incorrect: number; skipped: number;
} {
  let answered = 0, correct = 0;
  for (const q of spec.questions) {
    const selected = selections.get(q.id);
    if (selected === undefined) continue;
    answered++;
    if (selected === q.correctOptionId) correct++;
  }
  return {
    answered, correct, incorrect: answered - correct,
    skipped: spec.questions.length - answered,
  };
}
