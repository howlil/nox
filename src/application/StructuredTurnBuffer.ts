import type { StructuredStreamEvent } from "../agent/StructuredStreamParser";
import type { TurnContextSnapshot } from "../context/context-types";
import type { EditProposal } from "../types";
import type { ReviewFinding } from "../domain/review/types";
import type { PracticeEvaluation, PracticeQuestion } from "../domain/practice/types";
import type { PracticeEvaluationAttempt } from "../domain/practice/PracticeStateMachine";
import type { LearningEvent, LearningRequest } from "./learning-types";
import { InvalidLearningOutputError } from "./turn-output-error";

/** Validates and buffers untrusted structured-stream candidates.
 * The owning turn coordinator controls all durable effects after terminal success.
 */
export class StructuredTurnBuffer {
  readonly reviewBuffer: { observed: boolean; findings: ReviewFinding[] } = { observed: false, findings: [] };
  readonly practiceBuffer: { evaluation?: PracticeEvaluation; question?: PracticeQuestion } = {};
  readonly proposalBuffer: { proposal?: EditProposal } = {};

  constructor(
    private readonly request: LearningRequest,
    private readonly context: TurnContextSnapshot,
    private readonly practiceAttempt?: PracticeEvaluationAttempt,
  ) {}

  *map(
    events: StructuredStreamEvent[],
  ): Iterable<LearningEvent> {
    for (const event of events) {
      if (event.type === "scope-decision") {
        throw new InvalidLearningOutputError("Unexpected scope decision outside a locked learning mode.");
      }
      if (event.type === "text") {
        if (event.text) {
          yield {
            type: "response-delta",
            text: event.text,
          };
        }
        continue;
      }

      if (event.type === "thought") {
        if (event.text) {
          yield {
            type: "thought-delta",
            text: event.text,
          };
        }
        continue;
      }

      if (event.type === "proposal") {
        if (this.request.action !== "edit") {
          throw new InvalidLearningOutputError("Edit proposal is not valid for this action.");
        }
        if (!this.context.mutableFile || event.proposal.file !== this.context.mutableFile) {
          throw new InvalidLearningOutputError(`Edit target is not the active mutable note: ${event.proposal.file}`);
        }
        if (this.proposalBuffer.proposal) {
          throw new InvalidLearningOutputError("Agent returned multiple edit proposals for one turn.");
        }
        this.proposalBuffer.proposal = event.proposal;
        continue;
      }

      if (event.type === "practice-question") {
        if (this.request.action !== "practice") {
          throw new InvalidLearningOutputError("Practice question is not valid for this action.");
        }
        if (this.practiceAttempt) {
          throw new InvalidLearningOutputError("Agent returned a new practice question before finishing evaluation.");
        }
        if (this.practiceBuffer.question) {
          throw new InvalidLearningOutputError("Agent returned multiple questions for one Practice turn.");
        }
        // Parser output is not durable or actionable before terminal success.
        this.practiceBuffer.question = event.question;
        continue;
      }

      if (event.type === "review-findings") {
        if (this.request.action !== "review" || this.reviewBuffer.observed) {
          throw new InvalidLearningOutputError("Unexpected or duplicate Review payload.");
        }
        // A complete provider turn is required before committing Review.
        // Do not persist partial findings if the stream later fails.
        this.reviewBuffer.observed = true;
        this.reviewBuffer.findings.push(...event.findings);
        continue;
      }

      if (event.type === "practice-evaluation") {
        if (this.request.action !== "practice" || !this.practiceAttempt) {
          throw new InvalidLearningOutputError("Practice evaluation arrived without an active answer attempt.");
        }
        if (this.practiceBuffer.evaluation) {
          throw new InvalidLearningOutputError("Agent returned multiple evaluations for the same question.");
        }
        // Do not persist an evaluation just because its fenced block parsed.
        // The runtime can still fail, cancel, or emit malformed output afterwards.
        this.practiceBuffer.evaluation = event.evaluation;
        continue;
      }

      throw new InvalidLearningOutputError(event.message);
    }
  }
}
