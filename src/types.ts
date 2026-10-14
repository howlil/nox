import type { TranscriptPart } from "./session/transcript-types";
export type { ChatSession } from "./session/transcript-types";

// Shared transport/session types.

// ── Context ─────────────────────────────────────────────────────────────────

export type AgentContext =
  | { type: "selection"; file: string; content: string }
  | { type: "note"; file: string; content: string };

export interface AgentInput {
  prompt: string;
  context: AgentContext[];
}

// ── Agent transport ─────────────────────────────────────────────────────────

export interface AgentTurnInput {
  role: "user";
  content: string;
}

export type AgentFailureCode =
  | "runtime-unavailable"
  | "permission-required"
  | "protocol-invalid"
  | "process-failed"
  | "persistence-failed"
  | "unknown";

export interface AgentFailure {
  code: AgentFailureCode;
  message: string;
  diagnostic?: string;
}

export type AgentHealth =
  | { status: "ready" }
  | { status: "unavailable" | "misconfigured"; failure: AgentFailure };

export type AgentStreamEvent =
  | { type: "text"; content: string }
  | { type: "completed"; conversationId?: string; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "failed"; failure: AgentFailure }
  | { type: "cancelled" };

// ── Mutation proposal ───────────────────────────────────────────────────────

export interface EditProposal {
  file: string;
  original: string;
  replacement: string;
  reason?: string;
}

export type ApplyResult =
  | { ok: true; statusSync?: "failed"; message?: string }
  | {
      ok: false;
      reason:
        | "stale"
        | "ambiguous"
        | "unauthorized"
        | "missing-file"
        | "no-editor"
        | "status-unsaved"
        | "error";
      message: string;
    };

/** Provider-measured numbers are separate from budget estimates. */
export interface AgentTurnMetrics {
  estimatedInputTokens: number;
  estimatedContextTokens: number;
  estimatedHistoryTokens: number;
  shortenedSources: number;
  retrievedChunks: number;
  compacted: boolean;
  firstTokenMs?: number;
  elapsedMs: number;
  providerInputTokens?: number;
  providerOutputTokens?: number;
}

// ── Session ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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

export interface AgentModel {
  id: string;
  name: string;
}

// ── Agent runtime boundary ──────────────────────────────────────────────────

export interface AgentAdapter {
  check(): Promise<AgentHealth>;

  send(
    input: AgentInput,
    opts: SendOptions,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent>;

  listModels(signal?: AbortSignal): Promise<AgentModel[]>;

}

export interface AgentRuntimeConfig {
  executablePath?: string;
}

export interface SendOptions {
  model?: string;
  conversationId?: string;
  /** Canonical local transcript for stateless HTTP model transports. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}
