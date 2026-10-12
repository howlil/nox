import type { TranscriptPart } from "./transcript-types";

/** Reject malformed plugin data before it reaches the UI. */
export function isTranscriptPart(value: unknown): value is TranscriptPart {
  if (!value || typeof value !== "object") return false;
  const part = value as Record<string, unknown>;
  if (part.type === "practice-question") {
    const q = part.question as Record<string, unknown> | undefined;
    const origin = part.origin as Record<string, unknown> | undefined;
    return Boolean(q && q.kind === "question" && typeof q.concept === "string" &&
      typeof q.question === "string" && (q.hint === undefined || typeof q.hint === "string") &&
      (part.questionId === undefined || typeof part.questionId === "string") &&
      (origin === undefined || (typeof origin.file === "string" &&
        (origin.selectedText === undefined || typeof origin.selectedText === "string"))));
  }
  if (part.type === "practice-evaluation") {
    const e = part.evaluation as Record<string, unknown> | undefined;
    return Boolean(e && e.kind === "evaluation" && typeof e.concept === "string" &&
      ["correct", "partial", "incorrect"].includes(String(e.outcome)) &&
      typeof e.feedback === "string" && Array.isArray(e.misconceptions) &&
      e.misconceptions.every((value: unknown) => typeof value === "string") &&
      (e.nextQuestion === undefined || typeof e.nextQuestion === "string") &&
      (part.questionId === undefined || typeof part.questionId === "string"));
  }
  if (part.type === "review-findings") {
    return Array.isArray(part.findings) &&
      (part.sourcePath === undefined || typeof part.sourcePath === "string") &&
      part.findings.every((value: unknown) => {
        if (!value || typeof value !== "object") return false;
        const f = value as Record<string, unknown>;
        return ["misconception", "missing-relation", "factual-error", "weak-explanation"]
          .includes(String(f.kind)) && typeof f.concept === "string" &&
          typeof f.title === "string" && typeof f.detail === "string";
      });
  }
  return false;
}
