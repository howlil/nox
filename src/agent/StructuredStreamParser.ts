import { EditProposal } from "../types";
import {
  PracticeEvaluation,
  PracticePayload,
  PracticeQuestion,
  isRubricResults,
} from "../domain/practice/types";
import { ReviewFinding, ReviewPayload } from "../domain/review/types";
import type { ScopeOutcome } from "../domain/practice/learning-scope";

export type StructuredStreamEvent =
  | { type: "scope-decision"; outcome: ScopeOutcome }
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: EditProposal }
  | { type: "practice-question"; question: PracticeQuestion }
  | { type: "practice-evaluation"; evaluation: PracticeEvaluation }
  | { type: "review-findings"; findings: ReviewFinding[] }
  | { type: "error"; message: string };

type BlockKind = "edit-proposal" | "learning-practice" | "learning-review" | "learning-scope";

const START_TAGS: Array<{
  kind: BlockKind;
  marker: string;
}> = [
  { kind: "learning-scope", marker: "```learning-scope" },
  { kind: "edit-proposal", marker: "```edit-proposal" },
  { kind: "learning-practice", marker: "```learning-practice" },
  { kind: "learning-review", marker: "```learning-review" },
];

const END_TAG = "\n```";
const MAX_MARKER_LENGTH = Math.max(
  ...START_TAGS.map((item) => item.marker.length),
);

function isEditProposal(value: unknown): value is EditProposal {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  return (
    typeof obj.file === "string" &&
    typeof obj.original === "string" &&
    typeof obj.replacement === "string" &&
    (obj.reason === undefined || typeof obj.reason === "string")
  );
}

function isPracticePayload(value: unknown): value is PracticePayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  if (obj.kind === "question") {
    return (
      typeof obj.concept === "string" &&
      typeof obj.question === "string" &&
      (obj.hint === undefined || typeof obj.hint === "string")
    );
  }

  if (obj.kind === "evaluation") {
    return (
      typeof obj.concept === "string" &&
      (obj.outcome === "correct" ||
        obj.outcome === "partial" ||
        obj.outcome === "incorrect") &&
      typeof obj.feedback === "string" &&
      Array.isArray(obj.misconceptions) &&
      obj.misconceptions.every((item) => typeof item === "string") &&
      (obj.nextQuestion === undefined ||
        typeof obj.nextQuestion === "string") &&
      (obj.rubricResults === undefined || isRubricResults(obj.rubricResults))
    );
  }

  return false;
}

function isReviewPayload(value: unknown): value is ReviewPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (obj.kind !== "review" || !Array.isArray(obj.findings)) return false;

  return obj.findings.every((item) => {
    if (!item || typeof item !== "object") return false;
    const finding = item as Record<string, unknown>;
    return (
      (finding.kind === "misconception" ||
        finding.kind === "missing-relation" ||
        finding.kind === "factual-error" ||
        finding.kind === "weak-explanation") &&
      typeof finding.concept === "string" &&
      typeof finding.title === "string" &&
      typeof finding.detail === "string"
    );
  });
}

function findStart(buffer: string):
  | { kind: BlockKind; marker: string; index: number }
  | undefined {
  let best:
    | { kind: BlockKind; marker: string; index: number }
    | undefined;

  for (const candidate of START_TAGS) {
    const index = buffer.indexOf(candidate.marker);
    if (index < 0) continue;

    if (!best || index < best.index) {
      best = {
        ...candidate,
        index,
      };
    }
  }

  return best;
}

/**
 * Incremental parser for the small structured protocol embedded in streamed
 * model text. UI code only receives normalized events.
 */
export class StructuredStreamParser {
  private buffer = "";
  private mode: "text" | BlockKind = "text";

  push(chunk: string): StructuredStreamEvent[] {
    this.buffer += chunk;
    return this.drain(false);
  }

  finish(): StructuredStreamEvent[] {
    return this.drain(true);
  }

  private drain(final: boolean): StructuredStreamEvent[] {
    const events: StructuredStreamEvent[] = [];

    while (this.buffer.length > 0) {
      if (this.mode === "text") {
        const start = findStart(this.buffer);

        if (start) {
          const visible = this.buffer.slice(0, start.index);
          if (visible) {
            events.push({
              type: "text",
              text: visible,
            });
          }

          this.buffer = this.buffer.slice(
            start.index + start.marker.length,
          );
          this.mode = start.kind;
          continue;
        }

        if (final) {
          events.push({
            type: "text",
            text: this.buffer,
          });
          this.buffer = "";
          break;
        }

        const keep = Math.min(
          MAX_MARKER_LENGTH - 1,
          this.buffer.length,
        );
        const emitLength = this.buffer.length - keep;

        if (emitLength > 0) {
          events.push({
            type: "text",
            text: this.buffer.slice(0, emitLength),
          });
          this.buffer = this.buffer.slice(emitLength);
        }
        break;
      }

      const end = this.buffer.indexOf(END_TAG);

      if (end < 0) {
        if (final) {
          events.push({
            type: "error",
            message: `Incomplete ${this.mode} block returned by the agent.`,
          });
          this.buffer = "";
          this.mode = "text";
        }
        break;
      }

      const raw = this.buffer.slice(0, end).trim();
      const blockKind = this.mode;

      this.buffer = this.buffer.slice(end + END_TAG.length);
      this.mode = "text";

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        events.push({
          type: "error",
          message: `Could not parse ${blockKind} returned by the agent.`,
        });
        continue;
      }

      if (blockKind === "learning-scope") {
        const outcome = parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>).outcome : undefined;
        if (outcome === "answer" || outcome === "help" || outcome === "out-of-scope") {
          events.push({ type: "scope-decision", outcome });
        } else {
          events.push({ type: "error", message: "Agent returned an invalid scope decision." });
        }
        continue;
      }

      if (blockKind === "edit-proposal") {
        if (!isEditProposal(parsed)) {
          events.push({
            type: "error",
            message: "Agent returned an invalid edit proposal.",
          });
          continue;
        }

        events.push({
          type: "proposal",
          proposal: parsed,
        });
        continue;
      }

      if (blockKind === "learning-review") {
        if (!isReviewPayload(parsed)) {
          events.push({
            type: "error",
            message: "Agent returned an invalid review payload.",
          });
          continue;
        }

        events.push({
          type: "review-findings",
          findings: parsed.findings,
        });
        continue;
      }

      if (!isPracticePayload(parsed)) {
        events.push({
          type: "error",
          message: "Agent returned an invalid practice payload.",
        });
        continue;
      }

      if (parsed.kind === "question") {
        events.push({
          type: "practice-question",
          question: parsed,
        });
      } else {
        events.push({
          type: "practice-evaluation",
          evaluation: parsed,
        });
      }
    }

    return events;
  }
}
