import type { PracticeAnswer, PracticeInput, PracticeQuestion, PracticeEvaluation } from "./types";

const text = (x: unknown, max = 12000): x is string =>
  typeof x === "string" && x.trim().length > 0 && x.length <= max;

export function isPracticeInput(input: unknown): input is PracticeInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const x = input as Record<string, unknown>;
  if (x.type === "multiple-choice") {
    if (!Array.isArray(x.options) || x.options.length < 2 || x.options.length > 6 ||
        !text(x.correctOptionId, 80) || !text(x.explanation, 2400)) return false;
    const ids = new Set<string>();
    return x.options.every((option: unknown) => {
      if (!option || typeof option !== "object") return false;
      const v = option as Record<string, unknown>;
      if (!text(v.id, 80) || !text(v.text, 1500) || ids.has(v.id)) return false;
      ids.add(v.id);
      return true;
    }) && ids.has(x.correctOptionId);
  }
  if (x.type === "essay") {
    return (x.criteria === undefined || (Array.isArray(x.criteria) &&
      x.criteria.length <= 12 && x.criteria.every((c: unknown) => text(c, 500)))) &&
      (x.minWords === undefined || (Number.isInteger(x.minWords) &&
        (x.minWords as number) >= 0 && (x.minWords as number) <= 500));
  }
  if (x.type === "code") {
    return text(x.language, 40) && x.executionMode === "review-only" &&
      (x.starterCode === undefined || (typeof x.starterCode === "string" &&
        x.starterCode.length <= 12000)) &&
      (x.criteria === undefined || (Array.isArray(x.criteria) && x.criteria.length <= 12 &&
        x.criteria.every((c: unknown) => text(c, 500))));
  }
  return false;
}

function isInstructions(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const single = ["title", "brief"] as const;
  const groups = ["tasks", "requirements", "given", "expectedOutput"] as const;
  if (!single.every(key => v[key] === undefined ||
    (typeof v[key] === "string" && (v[key] as string).trim().length > 0 &&
      (v[key] as string).length <= (key === "title" ? 180 : 1800)))) return false;
  if (!groups.every(key => v[key] === undefined ||
    (Array.isArray(v[key]) && (v[key] as unknown[]).length > 0 &&
      (v[key] as unknown[]).length <= 12 &&
      (v[key] as unknown[]).every(item => text(item, 500))))) return false;
  return v.referenceCode === undefined ||
    (typeof v.referenceCode === "string" && v.referenceCode.length > 0 &&
      v.referenceCode.length <= 12000);
}

export function isPracticeQuestion(input: unknown): input is PracticeQuestion {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const x = input as Record<string, unknown>;
  return x.kind === "question" && text(x.concept, 300) && text(x.question, 12000) &&
    (x.hint === undefined || (typeof x.hint === "string" && x.hint.length <= 2000)) &&
    (x.instructions === undefined || isInstructions(x.instructions)) &&
    (x.input === undefined || isPracticeInput(x.input)) &&
    (x.programId === undefined || text(x.programId, 250)) &&
    (x.objectiveId === undefined || text(x.objectiveId, 250));
}

export function isPracticeAnswer(input: unknown): input is PracticeAnswer {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const x = input as Record<string, unknown>;
  if (x.type === "multiple-choice") return text(x.optionId, 80);
  if (x.type === "essay") return text(x.text, 16000);
  if (x.type === "code") return text(x.language, 40) && text(x.source, 40000);
  return false;
}

export function validatePracticeAnswer(question: PracticeQuestion, answer: PracticeAnswer): string {
  if (!isPracticeAnswer(answer)) throw new Error("Answer is empty or exceeds the supported size.");
  const type = question.input?.type ?? "essay";
  if (type !== answer.type) throw new Error("Answer type does not match the active question.");
  if (answer.type === "multiple-choice") {
    if (!question.input || question.input.type !== "multiple-choice" ||
        !question.input.options.some((o) => o.id === answer.optionId)) {
      throw new Error("Choose one of the available answers.");
    }
    return question.input.options.find(o => o.id === answer.optionId)!.text;
  }
  if (answer.type === "essay") {
    if (question.input?.type === "essay" && question.input.minWords &&
        answer.text.trim().split(/\s+/).length < question.input.minWords) {
      throw new Error("Answer needs at least " + question.input.minWords + " words.");
    }
    return answer.text;
  }
  if (question.input?.type !== "code" ||
      answer.language !== question.input.language) {
    throw new Error("Code language does not match the active question.");
  }
  return answer.source;
}

/** Multiple-choice grading is deterministic and does not require a model call. */
export function gradeMultipleChoice(question: PracticeQuestion, answer: PracticeAnswer): PracticeEvaluation {
  if (!question.input || question.input.type !== "multiple-choice" ||
      answer.type !== "multiple-choice") throw new Error("Not a multiple-choice answer.");
  validatePracticeAnswer(question, answer);
  const correct = answer.optionId === question.input.correctOptionId;
  return {
    kind: "evaluation", concept: question.concept,
    outcome: correct ? "correct" : "incorrect",
    feedback: question.input.explanation,
    misconceptions: correct ? [] : ["Review the reasoning behind the correct option."],
  };
}
