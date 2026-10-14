import type { AgentContext, ApplyResult, ChatMessage, ChatSession, EditProposal, ResponseVersion } from "../types";
import type { ExplicitContextRef, LearningContext, LearningPolicy } from "../context/context-types";
import type { ResearchResult } from "../context/LocalResearch";
import type { LearningState } from "../domain/learning-state/types";
import type { TranscriptPart } from "../session/transcript-types";
import type { LearningScopeState } from "../domain/practice/learning-scope";
import type { PracticeAnswer } from "../domain/practice/types";
import type { ProgramCollection } from "../domain/learning-program/types";

export interface ProgramStorePort {
  load(): Promise<ProgramCollection>;
  save(next: ProgramCollection): Promise<void>;
}

/** Application-owned structural I/O contracts, not a second authority. */
export interface SessionPort {
  configureRuntime(provider: string, preferredModel?: string, options?: RuntimeSettingsWrite): Promise<void>;
  getSession(): ChatSession;
  listSessions(includeArchived?: boolean): ChatSession[];
  mutateHistory(ids: string[], action: "archive" | "restore" | "delete"): Promise<{
    affected: number;
    activeSessionChanged: boolean;
  }>;
  selectSession(id: string): Promise<ChatSession | null>;
  setModel(modelId?: string): Promise<void>;
  newSession(): Promise<ChatSession>;
  forkSession(parentId: string, anchorMessageId: string): Promise<{ session: ChatSession; draftUserPrompt?: string }>;
  recordScopeChange(state: LearningScopeState, command: string, reply: string, sessionId: string): Promise<void>;
  recordUserMessage(content: string, sessionId?: string, action?: ChatMessage["action"],
    messageId?: string, replyTo?: ChatMessage["replyTo"]): Promise<void>;
  recordPracticeHint(hint: string, sessionId: string): Promise<void>;
  savePracticeDraft(questionId: string, answer: PracticeAnswer, sessionId?: string): Promise<void>;
  setConversationId(conversationId?: string, sessionId?: string): Promise<void>;
  recordAssistantMessage(content: string, sourcePath?: string, sessionId?: string, thought?: string, elapsedMs?: number, metrics?: import("../types").AgentTurnMetrics): Promise<void>;
  recordRegeneratedResponse(messageIndex: number, expectedContent: string, replacement: ResponseVersion, sessionId: string, conversationId?: string, metrics?: import("../types").AgentTurnMetrics): Promise<void>;
  selectResponseVersion(messageIndex: number, versionIndex: number, sessionId: string): Promise<void>;
  recordStructuredPart(part: TranscriptPart, sourcePath?: string, sessionId?: string): Promise<void>;
  recordPracticeOutcome(parts: TranscriptPart[], operationId: string, sourcePath: string, sessionId: string): Promise<TranscriptPart[]>;
  recordReviewOutcome(part: Extract<TranscriptPart, { type: "review-findings" }>, sourcePath: string, sessionId: string): Promise<Extract<TranscriptPart, { type: "review-findings" }>>;
  recordEditOutcome(proposalId: string, proposal: EditProposal, narrative: string,
    mutableFile: string, sessionId: string): Promise<{ proposal: EditProposal;
      state: "pending" | "applied" | "rejected" | "stale" }>;
  getProposal(proposalId: string): { proposal: EditProposal; mutableFile?: string; state: "pending" | "applied" | "rejected" | "stale" } | null;
  updateProposalState(proposalId: string, state: "applied" | "rejected" | "stale", sessionId?: string): Promise<void>;
}
export interface ContextPort {
  resolve(explicit?: ExplicitContextRef[]): Promise<LearningContext>;
  searchNotes(query: string, limit?: number): Array<{ path: string; name: string }>;
  toAgentContext(context: LearningContext): AgentContext[];
  searchKnowledge?(query: string, options?: { allowedPaths?: string[]; limit?: number }): Promise<ResearchResult>;
}
export interface RuntimeSettingsWrite {
  updateModel?: boolean;
  updateData?: (current: Record<string, unknown>) => Record<string, unknown>;
}
export interface PolicyPort { load(): Promise<LearningPolicy>; }
export interface MutationPort { apply(proposal: EditProposal, mutableFile?: string): Promise<ApplyResult>; }
export interface LearningStatePort { load(): Promise<LearningState>; save(state: LearningState): Promise<void>; }
