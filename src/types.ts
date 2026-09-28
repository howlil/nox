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
  | { type: "completed"; conversationId?: string }
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
  | { ok: true }
  | {
      ok: false;
      reason:
        | "stale"
        | "ambiguous"
        | "unauthorized"
        | "missing-file"
        | "no-editor"
        | "error";
      message: string;
    };

// ── Session ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sourcePath?: string;
  proposalId?: string;
  proposal?: EditProposal;
  proposalMutableFile?: string;
  proposalState?: "pending" | "applied" | "rejected" | "stale";
}

export interface ChatSession {
  id: string;
  conversationId?: string;
  model?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
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

  listModels(): Promise<AgentModel[]>;

}

export interface AgentRuntimeConfig {
  executablePath?: string;
}

export interface SendOptions {
  model?: string;
  conversationId?: string;
}
