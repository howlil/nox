import type { ChatSession } from "../../../types";
import type { LearningState } from "../../../domain/learning-state/types";
import type { LearningStatePort } from "../../../application/ports";
import { LearningStateWriteConflict } from "../../../persistence/PersistenceError";
import { recordPracticeEvaluation, recordReviewFindings } from "../../../domain/learning-state/transitions";

/** Reconciles committed transcript outcomes into the durable learning ledger.
 * Bounded CAS retries preserve one authoritative learning-state writer.
 */
export class TranscriptEvidenceReconciler {
  constructor(private readonly learningState: LearningStatePort) {}

  /**
   * Project a committed transcript event against the latest durable evidence
   * snapshot. CAS conflicts are recoverable; duplicate event IDs are no-ops.
   * Other persistence failures are surfaced rather than silently ignored.
   */
  async appendSafely(
    transition: (current: LearningState) => LearningState,
    initial?: LearningState,
  ): Promise<{ state: LearningState; appended: boolean }> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = attempt === 0 && initial ? initial : await this.learningState.load();
      const after = transition(before);
      if (after.evidence.length === before.evidence.length) {
        return { state: before, appended: false };
      }
      try {
        await this.learningState.save(after, before);
        return { state: after, appended: true };
      } catch (error) {
        if (!(error instanceof LearningStateWriteConflict) || attempt === 3) throw error;
      }
    }
    throw new LearningStateWriteConflict();
  }

  /** Replays transcript outcomes after a failed progress write without reevaluation. */
  async reconcileTranscript(
    session: ChatSession,
    initial: LearningState,
  ): Promise<LearningState> {
    const replay = (source: LearningState): LearningState => {
      let state = source;
      const existingIds = new Set(source.evidence.map(item => item.id));
      for (const message of session.messages.slice(session.fork?.inheritedMessageCount ?? 0)) {
        for (const part of message.parts ?? []) {
          if (part.type === "practice-evaluation" && part.questionId) {
            const operationId = part.operationId ?? `practice:${session.id}:${part.questionId}`;
            if (existingIds.has(operationId)) continue;
            const next = recordPracticeEvaluation(state, {
              evaluation: part.evaluation,
              source: part.sourcePath ?? message.sourcePath ?? "learning-session",
              evidenceId: operationId,
              programId: part.evaluation.programId,
              objectiveId: part.evaluation.objectiveId,
              assisted: part.evaluation.assisted,
              questionId: part.questionId,
            });
            if (next.evidence.length !== state.evidence.length) {
              state = next;
              existingIds.add(operationId);
            }
          }
          if (part.type === "review-findings" && part.reviewId) {
            if (part.findings.every((_, index) => existingIds.has(part.reviewId + ":" + index))) continue;
            const next = recordReviewFindings(state, {
              findings: part.findings,
              source: part.sourcePath ?? message.sourcePath ?? "learning-session",
              reviewId: part.reviewId,
            });
            if (next.evidence.length !== state.evidence.length) {
              state = next;
              for (let index = 0; index < part.findings.length; index++) {
                existingIds.add(part.reviewId + ":" + index);
              }
            }
          }
        }
      }
      return state;
    };
    return (await this.appendSafely(replay, initial)).state;
  }

}
