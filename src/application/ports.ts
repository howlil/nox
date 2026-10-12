import type { AgentContext, ApplyResult, ChatMessage, ChatSession, EditProposal } from "../types";
import type { ExplicitContextRef, LearningContext, LearningPolicy } from "../context/context-types";
import type { LearningState } from "../domain/learning-state/types";
import type { TranscriptPart } from "../session/transcript-types";

/** Application-owned structural I/O contracts, not a second authority. */
export interface SessionPort {
  getSession(): ChatSession;
  listSessions(): ChatSession[];
  selectSession(id: string): Promise<ChatSession | null>;
  setModel(modelId?: string): Promise<void>;
  newSession(): Promise<ChatSession>;
  recordUserMessage(content: string, sessionId?: string, action?: ChatMessage["action"]): Promise<void>;
  setConversationId(conversationId?: string, sessionId?: string): Promise<void>;
  recordAssistantMessage(content: string, sourcePath?: string, sessionId?: string): Promise<void>;
  recordStructuredPart(part: TranscriptPart, sourcePath?: string, sessionId?: string): Promise<void>;
  recordPracticeOutcome(parts: TranscriptPart[], operationId: string, sourcePath: string, sessionId: string): Promise<TranscriptPart[]>;
  recordReviewOutcome(part: Extract<TranscriptPart, { type: "review-findings" }>, sourcePath: string, sessionId: string): Promise<Extract<TranscriptPart, { type: "review-findings" }>>;
  recordProposal(proposalId: string, proposal: EditProposal, mutableFile?: string, sessionId?: string): Promise<void>;
  getProposal(proposalId: string): { proposal: EditProposal; mutableFile?: string; state: "pending" | "applied" | "rejected" | "stale" } | null;
  updateProposalState(proposalId: string, state: "applied" | "rejected" | "stale"): Promise<void>;
}
export interface ContextPort {
  resolve(explicit?: ExplicitContextRef[]): Promise<LearningContext>;
  searchNotes(query: string, limit?: number): Array<{ path: string; name: string }>;
  toAgentContext(context: LearningContext): AgentContext[];
}
export interface PolicyPort { load(): Promise<LearningPolicy>; }
export interface MutationPort { apply(proposal: EditProposal, mutableFile?: string): Promise<ApplyResult>; }
export interface LearningStatePort { load(): Promise<LearningState>; save(state: LearningState): Promise<void>; }
