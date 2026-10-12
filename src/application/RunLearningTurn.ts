import {
  AgentContext,
  AgentFailure,
  ChatSession,
} from "../types";
import type { ContextResolver } from "../context/ContextResolver";
import {
  ExplicitContextRef,
  LearningContext,
  TurnContextSnapshot,
} from "../context/context-types";
import type { PolicyLoader } from "../context/PolicyLoader";
import type { VaultLearningStore } from "../persistence/VaultLearningStore";
import { PersistenceError } from "../persistence/PersistenceError";
import {
  recordPracticeEvaluation,
  recordReviewFindings,
} from "../domain/learning-state/transitions";
import type { SessionController } from "../session/SessionController";
import { findCommittedPracticeOutcome, findCommittedReview } from "../session/transcript-types";
import type { ReviewFinding } from "../learning/review-types";
import type { TranscriptPart } from "../session/transcript-types";
import type { AgentRuntimePort } from "../agent/AgentRuntime";
import {
  buildActionInstruction,
  buildPracticeEvaluationInstruction,
  buildPracticeQuestionInstruction,
} from "../learning/action-builders";
import { toPromptLearningState } from "../learning/learning-state-projection";
import {
  LearningEvent,
  LearningRequest,
  ProposedEdit,
} from "../learning/learning-types";
import { PracticeQuestion, PracticeOrigin } from "../learning/practice-types";
import {
  PracticeEvaluationAttempt,
  PracticeStateMachine,
} from "../learning/PracticeStateMachine";
import { PracticeSessionRegistry } from "../learning/PracticeSessionRegistry";
import {
  StructuredStreamEvent,
  StructuredStreamParser,
} from "../learning/StructuredStreamParser";

type SessionPort = Pick<
  SessionController,
  | "getSession"
  | "listSessions"
  | "selectSession"
  | "setModel"
  | "newSession"
  | "recordUserMessage"
  | "setConversationId"
  | "recordAssistantMessage"
  | "recordStructuredPart"
  | "recordPracticeOutcome"
  | "recordReviewOutcome"
  | "recordProposal"
  | "getProposal"
  | "updateProposalState"
>;

type ContextPort = Pick<
  ContextResolver,
  "resolve" | "searchNotes" | "toAgentContext"
>;

type PolicyPort = Pick<PolicyLoader, "load">;
type LearningStatePort = Pick<VaultLearningStore, "load" | "save">;

/**
 * Application boundary for the Learning OS.
 *
 * The view sends user intent here. This controller owns orchestration:
 * context -> policy -> learning state -> action -> agent session -> normalized
 * UI events. Provider transport stays behind the AgentRuntime boundary.
 */
/**
 * Application use case: one learning turn and its session-scoped practice state.
 * This is the sole owner of the active-turn lock, timeout, and normalized stream.
 */
export class RunLearningTurn {
  private readonly practices = new PracticeSessionRegistry();
  private activeTurn: {
    controller: AbortController;
    cancelReason?: "user" | "timeout" | "dispose";
  } | null = null;
  private readonly turnTimeoutMs: number;

  constructor(
    private readonly sessions: SessionPort,
    private readonly runtime: AgentRuntimePort,
    private readonly contexts: ContextPort,
    private readonly policies: PolicyPort,
    private readonly learningState: LearningStatePort,
    options: { turnTimeoutMs?: number } = {},
  ) {
    this.turnTimeoutMs = options.turnTimeoutMs ?? 60_000;
  }

  isRunning(): boolean {
    return this.activeTurn !== null;
  }

  hasActivePracticeQuestion(): boolean {
    return this.practiceForSession(this.sessions.getSession()).isWaitingForAnswer();
  }

  getActivePracticeOrigin(): PracticeOrigin | undefined {
    const practice = this.practiceForSession(this.sessions.getSession());
    return practice.isWaitingForAnswer() ? practice.snapshot()?.origin : undefined;
  }

  /** Reconstruct the active question from the same durable conversation transcript. */
  private practiceForSession(session: ChatSession): PracticeStateMachine {
    const practice = this.practices.forSession(session.id);
    if (practice.snapshot()) return practice;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const message = session.messages[i];
      if (message.role === "user" && message.action && message.action !== "practice") break;
      const parts = message.parts ?? [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j];
        if (part.type === "practice-evaluation") return practice;
        if (part.type === "practice-question") {
          practice.start(part.origin);
          practice.acceptQuestion(part.question, part.questionId);
          return practice;
        }
      }
    }
    return practice;
  }

  async resolveContext(
    explicitContext: ExplicitContextRef[] = [],
  ): Promise<LearningContext> {
    return this.contexts.resolve(explicitContext);
  }

  searchNotes(
    query: string,
    limit = 8,
  ): Array<{ path: string; name: string }> {
    return this.contexts.searchNotes(query, limit);
  }

  async *run(
    request: LearningRequest,
  ): AsyncIterable<LearningEvent> {
    if (this.activeTurn) {
      yield {
        type: "failed",
        failure: {
          code: "busy",
          message: "Another Nox turn is still running.",
        },
      };
      return;
    }

    // Lock before asynchronous context/policy preparation.
    const controller = new AbortController();
    const activeTurn = { controller } as {
      controller: AbortController;
      cancelReason?: "user" | "timeout" | "dispose";
    };
    this.activeTurn = activeTurn;

    const sessionAtStart = this.sessions.getSession();
    const existingPractice = request.action === "practice"
      ? this.practiceForSession(sessionAtStart)
      : undefined;
    const previousOrigin = existingPractice?.isWaitingForAnswer()
      ? existingPractice.snapshot()?.origin
      : undefined;
    const pinnedPracticeSource = request.action === "practice"
      ? (previousOrigin?.file ?? request.sourcePath)
      : undefined;

    let context: LearningContext;
    let policy: Awaited<ReturnType<PolicyPort["load"]>>;
    let state: Awaited<ReturnType<LearningStatePort["load"]>>;

    try {
      const refs = [...request.explicitContext];
      const sourceRef = pinnedPracticeSource ?? request.sourcePath;
      if (sourceRef && !refs.some((ref) => ref.kind === "vault-note" && ref.path === sourceRef)) {
        refs.push({ kind: "vault-note", path: sourceRef });
      }
      context = await this.contexts.resolve(refs);
      [policy, state] = await Promise.all([
        this.policies.load(),
        this.learningState.load(),
      ]);
      state = await this.reconcileTranscriptEvidence(sessionAtStart, state);
    } catch (error) {
      if (this.activeTurn === activeTurn) this.activeTurn = null;
      yield {
        type: "failed",
        failure: {
          code: "unknown",
          message: "Nox could not prepare this learning turn.",
          diagnostic:
            error instanceof Error
              ? error.message
              : String(error),
        },
      };
      return;
    }

    if (controller.signal.aborted) {
      this.activeTurn = null;
      yield { type: "cancelled" };
      return;
    }

    if (request.sourcePath && request.action === "edit") {
      const primary = context.selection?.file ?? context.activeNote?.path;
      if (primary !== request.sourcePath) {
        this.activeTurn = null;
        yield {
          type: "failed",
          failure: {
            code: "unknown",
            message: `Open ${request.sourcePath} before fixing this review finding.`,
          },
        };
        return;
      }
    }

    const resolvedContext = this.contexts.toAgentContext(context);
    // A Review follow-up practices its originating material, even if the user
    // navigated to another note before sending. Other explicit refs remain additive.
    let visible = resolvedContext;
    if (pinnedPracticeSource && request.action === "practice") {
      const source = resolvedContext.find((item) => item.file === pinnedPracticeSource);
      if (!source) {
        this.activeTurn = null;
        yield {
          type: "failed",
          failure: {
            code: "unknown",
            message: `Practice source ${pinnedPracticeSource} is no longer available.`,
          },
        };
        return;
      }
      const automaticPath = context.selection?.file ?? context.activeNote?.path;
      visible = [
        ...(previousOrigin?.selectedText
          ? [{ type: "selection" as const, file: source.file, content: previousOrigin.selectedText }]
          : [source]),
        ...resolvedContext.filter(
          (item) => item !== source && item.file !== automaticPath,
        ),
      ];
    }
    const system: AgentContext[] = [];

    if (policy.rawInstructions) {
      const alreadyIncluded = visible.some(
        (item) =>
          item.type === "note" &&
          item.file === policy.path,
      );

      if (!alreadyIncluded) {
        system.push({
          type: "note",
          file: policy.path,
          content: policy.rawInstructions,
        });
      }
    }

    system.push({
      type: "note",
      file: "00-learning-os/progress.json",
      content: JSON.stringify(
        toPromptLearningState(state),
        null,
        2,
      ),
    });

    const readableFiles = Array.from(
      new Set(
        visible
          .filter(
            (item) =>
              !item.file.startsWith("attachment/"),
          )
          .map((item) => item.file),
      ),
    );

    const mutableFile =
      pinnedPracticeSource ??
      context.selection?.file ??
      context.activeNote?.path;

    const snapshot: TurnContextSnapshot = {
      resolved: context,
      visible,
      system,
      readableFiles,
      mutableFile,
    };

    yield { type: "context-ready", context: snapshot };

    const conversation = this.sessions.getSession();
    const turnSessionId = conversation.id;
    const practice = this.practiceForSession(conversation);

    let preparedPrompt: string;
    let practiceAttempt:
      | PracticeEvaluationAttempt
      | undefined;

    if (request.action === "practice") {
      if (practice.isWaitingForAnswer()) {
        const attempt =
          practice.beginEvaluation(request.prompt);

        if (!attempt) {
          if (this.activeTurn === activeTurn) this.activeTurn = null;
          yield {
            type: "failed",
            failure: {
              code: "unknown",
              message:
                "The active practice question is no longer available.",
            },
          };
          return;
        }

        practiceAttempt = attempt;
        preparedPrompt =
          buildPracticeEvaluationInstruction({
            question: attempt.question,
            answer: attempt.answer,
            concept: attempt.concept,
          });
      } else {
        const originFile = pinnedPracticeSource ??
          context.selection?.file ?? context.activeNote?.path;
        const origin: PracticeOrigin | undefined = originFile
          ? { file: originFile,
              selectedText: context.selection?.file === originFile
                ? context.selection.content : undefined }
          : undefined;
        practice.start(origin);
        preparedPrompt =
          buildPracticeQuestionInstruction(
            request.prompt,
          );
      }
    } else {
      this.practices.reset(conversation.id);
      const instruction =
        buildActionInstruction(request.action);
      preparedPrompt =
        `${instruction}\n\nUser request:\n${request.prompt}`;
    }

    const parser = new StructuredStreamParser();

    const timeout = setTimeout(() => {
      activeTurn.cancelReason = "timeout";
      controller.abort();
    }, this.turnTimeoutMs);

    let visibleText = "";
    let executionPhase: "agent" | "processing" = "agent";
    const reviewBuffer: { observed: boolean; findings: ReviewFinding[] } = {
      observed: false, findings: [],
    };

    const rollbackPractice = () => {
      if (practiceAttempt) {
        practice.rollbackEvaluation(
          practiceAttempt,
        );
      }
    };

    try {
      if (!request.retry) {
        await this.sessions.recordUserMessage(request.prompt, turnSessionId, request.action);
      }

      if (request.action === "review" && request.turnId) {
        const reviewId = `review:${turnSessionId}:${request.turnId}`;
        const committed = findCommittedReview(this.sessions.getSession(), reviewId);
        if (committed) {
          yield { type: "review-findings", findings: committed.findings };
          yield { type: "completed" };
          return;
        }
      }

      // A previous attempt can commit the outcome but fail while projecting
      // progress. Do not invoke the model again and risk a different verdict.
      if (practiceAttempt) {
        const committed = findCommittedPracticeOutcome(
          this.sessions.getSession(), practiceAttempt.questionId,
        );
        if (committed) {
          practice.commitEvaluation(practiceAttempt, committed.evaluation, committed.nextQuestionId);
          yield { type: "practice-evaluation", evaluation: committed.evaluation };
          if (committed.evaluation.nextQuestion?.trim()) {
            yield {
              type: "practice-question",
              question: {
                kind: "question",
                concept: committed.evaluation.concept,
                question: committed.evaluation.nextQuestion.trim(),
              },
            };
          }
          yield { type: "completed" };
          return;
        }
      }

      for await (const event of this.runtime.send(
        {
          prompt: preparedPrompt,
          context: [...snapshot.visible, ...snapshot.system],
        },
        {
          model: conversation.model,
          conversationId: conversation.conversationId,
        },
        controller.signal,
      )) {
        if (event.type === "text") {
          executionPhase = "processing";
          for await (const mapped of this.mapStructuredEvents(
            parser.push(event.content),
            request,
            snapshot,
            turnSessionId,
            practice,
            reviewBuffer,
            practiceAttempt,
          )) {
            if (mapped.type === "response-delta") {
              visibleText += mapped.text;
            }

            if (mapped.type === "mutation-proposed") {
              await this.sessions.recordAssistantMessage(
                visibleText,
                snapshot.mutableFile,
                turnSessionId,
              );
              visibleText = "";
              await this.sessions.recordProposal(
                mapped.edit.id,
                mapped.edit.proposal,
                snapshot.mutableFile,
                turnSessionId,
              );
            }

            yield mapped;
          }
          executionPhase = "agent";
          continue;
        }

        if (event.type === "completed") {
          executionPhase = "processing";
          if (event.conversationId) {
            await this.sessions.setConversationId(event.conversationId, turnSessionId);
          }

          for await (const mapped of this.mapStructuredEvents(
            parser.finish(),
            request,
            snapshot,
            turnSessionId,
            practice,
            reviewBuffer,
            practiceAttempt,
          )) {
            if (mapped.type === "response-delta") {
              visibleText += mapped.text;
            }

            if (mapped.type === "mutation-proposed") {
              await this.sessions.recordAssistantMessage(
                visibleText,
                snapshot.mutableFile,
                turnSessionId,
              );
              visibleText = "";
              await this.sessions.recordProposal(
                mapped.edit.id,
                mapped.edit.proposal,
                snapshot.mutableFile,
                turnSessionId,
              );
            }

            yield mapped;
          }

          if (
            practiceAttempt &&
            practice.snapshot()?.state ===
              "evaluating"
          ) {
            throw new Error(
              "Agent completed without a practice evaluation.",
            );
          }

          if (reviewBuffer.observed && request.action === "review") {
            const source = snapshot.resolved.selection?.file ??
              snapshot.resolved.activeNote?.path ?? "learning-session";
            const reviewId = `review:${turnSessionId}:${request.turnId ?? crypto.randomUUID()}`;
            const committed = await this.sessions.recordReviewOutcome(
              { type: "review-findings", reviewId, findings: reviewBuffer.findings, sourcePath: source },
              source,
              turnSessionId,
            );
            const before = await this.learningState.load();
            const after = recordReviewFindings(before, {
              findings: committed.findings, source: committed.sourcePath ?? source, reviewId,
            });
            if (after.evidence.length !== before.evidence.length) {
              await this.learningState.save(after);
              yield { type: "learning-state-updated", state: after };
            }
            yield { type: "review-findings", findings: committed.findings };
          }
          await this.sessions.recordAssistantMessage(
            visibleText,
            snapshot.mutableFile,
            turnSessionId,
          );
          yield { type: "completed" };
          return;
        }

        if (event.type === "failed") {
          rollbackPractice();
          yield {
            type: "failed",
            failure: event.failure,
          };
          return;
        }

        rollbackPractice();

        if (activeTurn.cancelReason === "timeout") {
          const seconds = Math.max(
            1,
            Math.ceil(this.turnTimeoutMs / 1000),
          );
          yield {
            type: "failed",
            failure: {
              code: "timeout",
              message:
                `No response after ${seconds} seconds. The agent runtime may be busy.`,
            },
          };
        } else {
          yield { type: "cancelled" };
        }
        return;
      }

      if (practiceAttempt) {
        rollbackPractice();
      }
    } catch (error) {
      rollbackPractice();

      const persistenceFailed = error instanceof PersistenceError;
      const failure: AgentFailure = {
        code: persistenceFailed ? "persistence-failed"
          : executionPhase === "agent" ? "process-failed" : "unknown",
        message: persistenceFailed
          ? "Nox could not save this turn. Retry after checking vault storage."
          : executionPhase === "agent"
            ? "The agent process failed during this turn."
            : "Nox could not complete this learning operation.",
        diagnostic: persistenceFailed
          ? error.diagnostic
          : error instanceof Error ? error.message : String(error),
      };

      yield { type: "failed", failure };
    } finally {
      clearTimeout(timeout);
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  /** Replays committed transcript outcomes missing from progress.json. */
  private async reconcileTranscriptEvidence(
    session: ChatSession,
    initial: Awaited<ReturnType<LearningStatePort["load"]>>,
  ): Promise<Awaited<ReturnType<LearningStatePort["load"]>>> {
    let state = initial;
    let changed = false;
    for (const message of session.messages) {
      for (const part of message.parts ?? []) {
        if (part.type === "practice-evaluation" && part.questionId) {
          const operationId = part.operationId ?? `practice:${session.id}:${part.questionId}`;
          const next = recordPracticeEvaluation(state, {
            evaluation: part.evaluation,
            source: part.sourcePath ?? message.sourcePath ?? "learning-session",
            evidenceId: operationId,
          });
          if (next.evidence.length !== state.evidence.length) {
            changed = true;
            state = next;
          }
        }
        if (part.type === "review-findings" && part.reviewId) {
          const next = recordReviewFindings(state, {
            findings: part.findings,
            source: part.sourcePath ?? message.sourcePath ?? "learning-session",
            reviewId: part.reviewId,
          });
          if (next.evidence.length !== state.evidence.length) {
            changed = true;
            state = next;
          }
        }
      }
    }
    if (changed) await this.learningState.save(state);
    return state;
  }

  cancel(): void {
    if (!this.activeTurn) return;
    this.activeTurn.cancelReason = "user";
    this.activeTurn.controller.abort();
  }

  dispose(): void {
    this.practices.clear();
    if (!this.activeTurn) return;
    this.activeTurn.cancelReason = "dispose";
    this.activeTurn.controller.abort();
  }

  private async *mapStructuredEvents(
    events: StructuredStreamEvent[],
    request: LearningRequest,
    context: TurnContextSnapshot,
    sessionId: string,
    practice: PracticeStateMachine,
    reviewBuffer: { observed: boolean; findings: ReviewFinding[] },
    practiceAttempt?: PracticeEvaluationAttempt,
  ): AsyncIterable<LearningEvent> {
    for (const event of events) {
      if (event.type === "text") {
        if (event.text) {
          yield {
            type: "response-delta",
            text: event.text,
          };
        }
        continue;
      }

      if (event.type === "proposal") {
        if (
          !context.mutableFile ||
          event.proposal.file !==
            context.mutableFile
        ) {
          throw new Error(
            `Edit target is not the active mutable note: ${event.proposal.file}`,
          );
        }

        const edit: ProposedEdit = {
          id: crypto.randomUUID(),
          proposal: event.proposal,
        };

        yield {
          type: "mutation-proposed",
          edit,
        };
        continue;
      }

      if (event.type === "practice-question") {
        const questionId = crypto.randomUUID();
        await this.sessions.recordStructuredPart(
          { type: "practice-question", question: event.question,
            questionId, origin: practice.snapshot()?.origin },
          context.mutableFile,
          sessionId,
        );
        practice.acceptQuestion(event.question, questionId);

        yield {
          type: "practice-question",
          question: event.question,
        };
        continue;
      }

      if (event.type === "review-findings") {
        // A complete provider turn is required before committing Review.
        // Do not persist partial findings if the stream later fails.
        reviewBuffer.observed = true;
        reviewBuffer.findings.push(...event.findings);
        continue;
      }

      if (event.type === "practice-evaluation") {
        if (!practiceAttempt) {
          throw new Error(
            "Practice evaluation arrived without an active answer attempt.",
          );
        }

        const source =
          practiceAttempt.origin?.file ??
          context.resolved.selection?.file ??
          context.resolved.activeNote?.path ??
          "learning-session";

        const nextText = event.evaluation.nextQuestion?.trim();
        const nextQuestion: PracticeQuestion | undefined = nextText
          ? { kind: "question", concept: event.evaluation.concept, question: nextText }
          : undefined;
        const nextId = nextQuestion ? crypto.randomUUID() : undefined;
        const operationId = `practice:${sessionId}:${practiceAttempt.questionId}`;
        const parts: TranscriptPart[] = [
          { type: "practice-evaluation", evaluation: event.evaluation,
            questionId: practiceAttempt.questionId, operationId,
            nextQuestionId: nextId, sourcePath: source },
          ...(nextQuestion ? [{
            type: "practice-question" as const, question: nextQuestion,
            questionId: nextId, origin: practice.snapshot()?.origin,
          }] : []),
        ];
        const committed = await this.sessions.recordPracticeOutcome(
          parts, operationId, source, sessionId,
        );
        const evaluationPart = committed.find((part) => part.type === "practice-evaluation");
        if (!evaluationPart || evaluationPart.type !== "practice-evaluation") {
          throw new Error("Committed practice outcome missing evaluation");
        }
        const currentState = await this.learningState.load();
        const nextState = recordPracticeEvaluation(currentState, {
          evaluation: evaluationPart.evaluation,
          source: evaluationPart.sourcePath ?? source,
          evidenceId: operationId,
        });
        if (nextState.evidence.length !== currentState.evidence.length) {
          await this.learningState.save(nextState);
        }

        practice.commitEvaluation(practiceAttempt, evaluationPart.evaluation, evaluationPart.nextQuestionId);
        yield { type: "practice-evaluation", evaluation: evaluationPart.evaluation };
        yield { type: "learning-state-updated", state: nextState };
        if (evaluationPart.evaluation.nextQuestion?.trim()) {
          yield { type: "practice-question", question: {
            kind: "question", concept: evaluationPart.evaluation.concept,
            question: evaluationPart.evaluation.nextQuestion.trim(),
          }};
        }

        continue;
      }

      throw new Error(event.message);
    }
  }
}
