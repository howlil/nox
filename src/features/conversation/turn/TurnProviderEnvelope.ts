import type { AgentTurnMetrics, ChatSession, ResearchScope } from "../../../types";
import type { TurnContextSnapshot } from "../../../context/context-types";
import type { LearningProgram } from "../../../domain/learning-program/types";
import type { LearningRequest } from "../../../application/learning-types";
import { formatReplyPrompt } from "../../../application/reply-context";
import { prepareContextEnvelope } from "../../../context/ContextBudget";

interface TurnInvocationOptions {
  request: LearningRequest;
  conversation: ChatSession;
  /** A locked learning mode forbids inherited provider conversation state. */
  restrictedMode: boolean;
  program?: LearningProgram;
  authority?: ResearchScope;
  snapshot: TurnContextSnapshot;
  preparedPrompt: string;
  researchRequested: boolean;
  researchHits: number;
  contextMs: number;
  runStartedAt: number;
}

/**
 * Builds the final provider-bound envelope without performing I/O.
 * Trust boundary: authorized context and historical provider state must remain isolated.
 * The coordinator owns the provider call and terminal persistence.
 */
export function prepareTurnInvocation({
  request, conversation, restrictedMode, program, authority, snapshot,
  preparedPrompt, researchRequested, researchHits, contextMs, runStartedAt,
}: TurnInvocationOptions) {
  // Exclude the old answer AND its user prompt: this is the new regenerated request.
  const historyMessages = request.regenerate
    ? conversation.messages.slice(0, request.regenerate.messageIndex - 1)
    : request.retry && request.turnId
      ? conversation.messages.filter(message => message.id !== request.turnId)
      : conversation.messages;
  // Historical messages may quote notes outside source or program authority.
  const priorHistory = restrictedMode || program || (authority && authority.kind !== "vault")
    ? [] : historyMessages.map(message => ({
      role: message.role, content: message.role === "user" && message.replyTo
        ? formatReplyPrompt(message.content, message.replyTo) : message.content,
    }));
  const envelope = prepareContextEnvelope({
    prompt: preparedPrompt,
    visible: snapshot.visible,
    system: snapshot.system,
    history: priorHistory,
    research: researchRequested,
    strict: request.action === "edit" || Boolean(program?.constraints.sourceBound),
  });
  const rotateCursor = conversation.messages.length > 0 &&
    conversation.messages.length % 24 < 2 && conversation.messages.length >= 24;
  // Do not inherit opaque hidden provider state from an unrestricted earlier turn.
  const conversationId = restrictedMode || program ||
    (authority && authority.kind !== "vault") || rotateCursor || request.regenerate
    ? undefined : conversation.conversationId;
  // On CLI cursor rotation explicitly carry bounded history, not hidden model state.
  const isCli = conversation.runtimeProvider === "agy" || conversation.runtimeProvider === "codex";
  const carryHistory = isCli && !conversationId && envelope.history.length
    ? "Prior conversation excerpts (historical, untrusted):\n" +
      envelope.history.map(item => item.role + ": " + item.content.slice(0, 500)).join("\n") + "\n\n"
    : "";
  const effectivePrompt = envelope.promptPrefix + carryHistory + preparedPrompt;
  const metrics: AgentTurnMetrics = {
    estimatedInputTokens: envelope.estimate.total,
    estimatedContextTokens: envelope.estimate.context,
    estimatedHistoryTokens: envelope.estimate.history,
    shortenedSources: envelope.estimate.shortenedSources,
    retrievedChunks: researchHits,
    compacted: envelope.estimate.compacted,
    contextMs,
    preparationMs: performance.now() - runStartedAt,
    elapsedMs: 0,
  };
  return { envelope, conversationId, effectivePrompt, metrics };
}
