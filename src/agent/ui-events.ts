/**
 * Normalized, intentionally minimal agent UI telemetry. This is additive:
 * learning events and existing provider adapters keep their contracts.
 * Events must represent observed runtime facts, never animated estimates.
 */
export type RunOutcome = "completed" | "failed" | "cancelled";
export type ToolOutcome = "completed" | "failed" | "cancelled";

export type AgentUIEvent =
  | { type: "run.started"; runId: string; at: number; provider: string; model?: string }
  | { type: "message.delta"; runId: string; at: number; text: string }
  | { type: "tool.started"; runId: string; at: number; toolCallId: string; name: string }
  | { type: "tool.finished"; runId: string; at: number; toolCallId: string; outcome: ToolOutcome }
  | { type: "usage.reported"; runId: string; at: number; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; source: "provider" | "runtime" }
  | { type: "approval.requested"; runId: string; at: number; approvalId: string; summary: string }
  | { type: "approval.resolved"; runId: string; at: number; approvalId: string; decision: "approved" | "rejected" }
  | { type: "run.finished"; runId: string; at: number; outcome: RunOutcome; errorCode?: string };

export interface AgentUICapabilities {
  toolEvents: boolean;
  usage: boolean;
  approvals: boolean;
  resumableRuns: boolean;
  citations: boolean;
}
export const NO_AGENT_UI_CAPABILITIES: Readonly<AgentUICapabilities> = Object.freeze({
  toolEvents: false, usage: false, approvals: false, resumableRuns: false, citations: false,
});

export interface ToolViewState { id: string; name: string; startedAt: number; finishedAt?: number; outcome?: ToolOutcome }
export interface ApprovalViewState { id: string; summary: string; requestedAt: number; decision?: "approved" | "rejected" }
export interface UsageViewState {
  inputTokens?: number; outputTokens?: number; cachedInputTokens?: number;
  source?: "provider" | "runtime";
}
export interface AgentRunViewState {
  runId: string;
  provider: string;
  model?: string;
  startedAt: number;
  finishedAt?: number;
  outcome?: RunOutcome;
  errorCode?: string;
  response: string;
  tools: ToolViewState[];
  approvals: ApprovalViewState[];
  usage?: UsageViewState;
}
const validCount = (n: number | undefined): boolean =>
  n === undefined || (Number.isSafeInteger(n) && n >= 0);

const validId = (id: string) => typeof id === "string" && id.trim().length > 0 && id.length <= 160;

/** Pure lifecycle reducer; invalid or stale facts leave state unchanged. */
export function reduceAgentUIEvent(
  state: AgentRunViewState | null,
  event: AgentUIEvent,
): AgentRunViewState | null {
  if (!Number.isFinite(event.at) || event.at < 0 || !validId(event.runId)) return state;
  if (event.type === "run.started") {
    if (state || !validId(event.provider)) return state;
    return { runId: event.runId, provider: event.provider, model: event.model,
      startedAt: event.at, response: "", tools: [], approvals: [] };
  }
  if (!state || state.runId !== event.runId || state.outcome || event.at < state.startedAt) return state;
  switch (event.type) {
    case "message.delta":
      if (typeof event.text !== "string") return state;
      return { ...state, response: state.response + event.text };
    case "tool.started":
      if (!validId(event.toolCallId) || !validId(event.name) ||
          state.tools.some(t => t.id === event.toolCallId)) return state;
      return { ...state, tools: [...state.tools, {
        id: event.toolCallId, name: event.name, startedAt: event.at,
      }] };
    case "tool.finished":
      if (!state.tools.some(t => t.id === event.toolCallId && !t.outcome)) return state;
      return { ...state, tools: state.tools.map(t => t.id === event.toolCallId && !t.outcome
        ? { ...t, finishedAt: event.at, outcome: event.outcome } : t) };
    case "usage.reported":
      if (![event.inputTokens, event.outputTokens, event.cachedInputTokens].every(validCount)) return state;
      return { ...state, usage: {
        inputTokens: event.inputTokens, outputTokens: event.outputTokens,
        cachedInputTokens: event.cachedInputTokens, source: event.source,
      } };
    case "approval.requested":
      if (!validId(event.approvalId) || state.approvals.some(a => a.id === event.approvalId)) return state;
      return { ...state, approvals: [...state.approvals, {
        id: event.approvalId, summary: event.summary, requestedAt: event.at,
      }] };
    case "approval.resolved":
      if (!state.approvals.some(a => a.id === event.approvalId && !a.decision)) return state;
      return { ...state, approvals: state.approvals.map(a => a.id === event.approvalId && !a.decision
        ? { ...a, decision: event.decision } : a) };
    case "run.finished":
      return { ...state, finishedAt: event.at, outcome: event.outcome, errorCode: event.errorCode };
  }
}
