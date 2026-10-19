import type { TranscriptPart } from "./transcript-part-types";

/** Durable message/agent metadata contracts, independent of transcript operations. */
export interface EditProposal {
  file: string;
  original: string;
  replacement: string;
  reason?: string;
}

export interface AgentTurnMetrics {
  estimatedInputTokens: number;
  estimatedContextTokens: number;
  estimatedHistoryTokens: number;
  shortenedSources: number;
  retrievedChunks: number;
  compacted: boolean;
  firstTokenMs?: number;
  /** From runtime invocation to the first provider text event (includes CLI spawn/auth). */
  providerFirstTextMs?: number;
  /** From runtime invocation through the provider's completed event. */
  providerDurationMs?: number;
  /** End-to-end time before context is prepared (includes session recovery). */
  contextMs?: number;
  /** End-to-end time before the runtime is invoked, including preflight persistence. */
  preparationMs?: number;
  /** End-to-end time when the first visible response text is emitted. */
  firstVisibleMs?: number;
  elapsedMs: number;
  providerInputTokens?: number;
  providerOutputTokens?: number;
}

export interface ResponseVersion {
  content: string;
  sourcePath?: string;
  thought?: string;
  elapsedMs?: number;
}

export interface ChatReplyReference {
  sourceSessionId: string;
  sourceMessageId: string;
  sourceRole: "assistant";
  quote: string;
}

export interface ChatMessage {
  id?: string;
  replyTo?: ChatReplyReference;
  role: "user" | "assistant";
  content: string;
  responseVersions?: ResponseVersion[];
  responseVersionIndex?: number;
  parts?: TranscriptPart[];
  /** Action retained for practice recovery after session reload. */
  action?: "ask" | "explain" | "practice" | "review" | "edit";
  sourcePath?: string;
  proposalId?: string;
  proposal?: EditProposal;
  proposalMutableFile?: string;
  proposalState?: "pending" | "applied" | "rejected" | "stale";
  thought?: string;
  elapsedMs?: number;
  metrics?: AgentTurnMetrics;
}

