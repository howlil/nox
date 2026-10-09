import {
  AgentContext,
  AgentFailure,
  AgentHealth,
  ApplyResult,
  AgentModel,
  ChatSession,
} from "../types";
import type { ContextResolver } from "../context/ContextResolver";
import {
  ExplicitContextRef,
  LearningContext,
  TurnContextSnapshot,
} from "../context/context-types";
import type { PolicyLoader } from "../context/PolicyLoader";
import type { MutationService } from "../mutation/MutationService";
import type { VaultLearningStore } from "../persistence/VaultLearningStore";
import {
  recordPracticeEvaluation,
  recordReviewFindings,
} from "../domain/learning-state/transitions";
import type { SessionController } from "../session/SessionController";
import type { AgentRuntimePort } from "../agent/AgentRuntime";
import {
  buildActionInstruction,
  buildPracticeEvaluationInstruction,
  buildPracticeQuestionInstruction,
} from "./action-builders";
import { toPromptLearningState } from "./learning-state-projection";
import {
  LearningEvent,
  LearningRequest,
  ProposedEdit,
} from "./learning-types";
import { PracticeQuestion } from "./practice-types";
import {
  PracticeEvaluationAttempt,
  PracticeStateMachine,
} from "./PracticeStateMachine";
import { PracticeSessionRegistry } from "./PracticeSessionRegistry";
import {
  StructuredStreamEvent,
  StructuredStreamParser,
} from "./StructuredStreamParser";

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
  | "recordProposal"
  | "getProposal"
  | "updateProposalState"
>;

type ContextPort = Pick<
  ContextResolver,
  "resolve" | "searchNotes" | "toAgentContext"
>;

type PolicyPort = Pick<PolicyLoader, "load">;
type MutationPort = Pick<MutationService, "apply">;
type LearningStatePort = Pick<VaultLearningStore, "load" | "save">;

export interface LearningControllerOptions {
  turnTimeoutMs?: number;
}

/**
 * Application boundary for the Learning OS.
 *
 * The view sends user intent here. This controller owns orchestration:
 * context -> policy -> learning state -> action -> agent session -> normalized
 * UI events. Provider transport stays behind the AgentRuntime boundary.
 */
export class LearningController {
  private readonly practices = new PracticeSessionRegistry();
  private readonly applyingProposals = new Set<string>();
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
    private readonly mutations: MutationPort,
    private readonly learningState: LearningStatePort,
    options: LearningControllerOptions = {},
  ) {
    this.turnTimeoutMs = options.turnTimeoutMs ?? 60_000;
  }

  checkRuntime(): Promise<AgentHealth> {
    return this.runtime.check();
  }

  getSession(): ChatSession {
    return this.sessions.getSession();
  }

  listSessions(): ChatSession[] {
    return this.sessions.listSessions();
  }

  getModels(): AgentModel[] {
    return this.runtime.getModels();
  }

  setModel(modelId?: string): Promise<void> {
    return this.sessions.setModel(modelId);
  }

  async newSession(): Promise<ChatSession> {
    if (this.activeTurn) throw new Error("Finish or stop the active turn before creating a session.");
    return this.sessions.newSession();
  }

  async selectSession(id: string): Promise<ChatSession | null> {
    if (this.activeTurn) throw new Error("Finish or stop the active turn before switching sessions.");
    return this.sessions.selectSession(id);
  }

  hasActivePracticeQuestion(): boolean {
    return this.practices.forSession(this.sessions.getSession().id).isWaitingForAnswer();
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

    let context: LearningContext;
    let policy: Awaited<ReturnType<PolicyPort["load"]>>;
    let state: Awaited<ReturnType<LearningStatePort["load"]>>;

    try {
      const refs = [...request.explicitContext];
      if (
        request.sourcePath &&
        !refs.some((ref) => ref.kind === "vault-note" && ref.path === request.sourcePath)
      ) {
        refs.push({ kind: "vault-note", path: request.sourcePath });
      }
      context = await this.contexts.resolve(refs);
      [policy, state] = await Promise.all([
        this.policies.load(),
        this.learningState.load(),
      ]);
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

    const visible = this.contexts.toAgentContext(context);
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
    const practice = this.practices.forSession(conversation.id);

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
        practice.start();
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

    const rollbackPractice = () => {
      if (practiceAttempt) {
        practice.rollbackEvaluation(
          practiceAttempt,
        );
      }
    };

    try {
      if (!request.retry) {
        await this.sessions.recordUserMessage(request.prompt, turnSessionId);
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
          for await (const mapped of this.mapStructuredEvents(
            parser.push(event.content),
            request,
            snapshot,
            practice,
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
          continue;
        }

        if (event.type === "completed") {
          if (event.conversationId) {
            await this.sessions.setConversationId(event.conversationId, turnSessionId);
          }

          for await (const mapped of this.mapStructuredEvents(
            parser.finish(),
            request,
            snapshot,
            practice,
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

      const failure: AgentFailure = {
        code: "protocol-invalid",
        message:
          "Nox could not interpret the agent response.",
        diagnostic:
          error instanceof Error
            ? error.message
            : String(error),
      };

      yield { type: "failed", failure };
    } finally {
      clearTimeout(timeout);
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  async applyProposal(
    proposalId: string,
  ): Promise<ApplyResult> {
    const record = this.sessions.getProposal(proposalId);

    if (this.applyingProposals.has(proposalId) || !record || record.state !== "pending") {
      return {
        ok: false,
        reason: "stale",
        message:
          "This proposal is no longer active. Regenerate the edit.",
      };
    }

    this.applyingProposals.add(proposalId);
    try {
      const result = await this.mutations.apply(
        record.proposal,
        record.mutableFile,
      );

      if (result.ok) {
        await this.sessions.updateProposalState(proposalId, "applied");
      } else if (
        result.reason === "stale" ||
        result.reason === "ambiguous" ||
        result.reason === "unauthorized" ||
        result.reason === "missing-file"
      ) {
        await this.sessions.updateProposalState(proposalId, "stale");
      }

      return result;
    } finally {
      this.applyingProposals.delete(proposalId);
    }
  }

  async rejectProposal(
    proposalId: string,
  ): Promise<void> {
    const record = this.sessions.getProposal(proposalId);
    if (!record || record.state !== "pending") return;

    await this.sessions.updateProposalState(
      proposalId,
      "rejected",
    );
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
    practice: PracticeStateMachine,
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
        practice.acceptQuestion(
          event.question,
        );

        yield {
          type: "practice-question",
          question: event.question,
        };
        continue;
      }

      if (event.type === "review-findings") {
        const source =
          context.resolved.selection?.file ??
          context.resolved.activeNote?.path ??
          "learning-session";

        yield {
          type: "review-findings",
          findings: event.findings,
        };

        if (event.findings.length > 0) {
          const currentState = await this.learningState.load();
          const nextState = recordReviewFindings(
            currentState,
            {
              findings: event.findings,
              source,
            },
          );
          await this.learningState.save(nextState);

          yield {
            type: "learning-state-updated",
            state: nextState,
          };
        }
        continue;
      }

      if (event.type === "practice-evaluation") {
        if (!practiceAttempt) {
          throw new Error(
            "Practice evaluation arrived without an active answer attempt.",
          );
        }

        const nextQuestion =
          practice.commitEvaluation(
            practiceAttempt,
            event.evaluation,
          );

        yield {
          type: "practice-evaluation",
          evaluation: event.evaluation,
        };

        const source =
          context.resolved.selection?.file ??
          context.resolved.activeNote?.path ??
          "learning-session";

        const currentState = await this.learningState.load();
        const nextState = recordPracticeEvaluation(
          currentState,
          {
            evaluation: event.evaluation,
            source,
          },
        );
        await this.learningState.save(nextState);

        yield {
          type: "learning-state-updated",
          state: nextState,
        };

        if (nextQuestion) {
          yield {
            type: "practice-question",
            question: nextQuestion,
          };
        }

        continue;
      }

      throw new Error(event.message);
    }
  }
}
