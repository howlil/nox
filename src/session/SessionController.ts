import { SessionStore } from "./SessionStore";
import { PersistenceError } from "../persistence/PersistenceError";
import type { TranscriptPart } from "./transcript-types";
import { findCommittedPracticeOutcome } from "./transcript-types";
import { PluginDataRepository } from "../persistence/PluginDataRepository";
import {
  ChatSession,
  EditProposal,
} from "../types";

/**
 * Owns durable conversation/session state.
 *
 * Agent runtime health, model discovery, and turn execution live in the
 * separate AgentRuntime boundary.
 */
export class SessionController {
  private currentSession: ChatSession | null = null;

  constructor(
    private readonly pluginData: PluginDataRepository,
    private readonly store: SessionStore,
  ) {}

  async init(): Promise<void> {
    const data = await this.pluginData.read();
    await this.store.load(data);

    this.currentSession = this.store.getCurrentSession();
    if (!this.currentSession) {
      this.currentSession = this.store.createSession(this.store.getDefaultModel());
    }
  }

  getSession(): ChatSession {
    if (!this.currentSession) throw new Error("Session not initialized");
    return structuredClone(this.currentSession);
  }

  async newSession(): Promise<ChatSession> {
    this.stalePendingProposals(this.currentSession);
    const model = this.currentSession?.model ?? this.store.getDefaultModel();
    this.currentSession = this.store.createSession(model);
    await this.save();
    return this.getSession();
  }

  listSessions(): ChatSession[] {
    return this.store.listSessions();
  }

  async selectSession(id: string): Promise<ChatSession | null> {
    const session = this.store.getSession(id);
    if (!session) return null;

    this.stalePendingProposals(this.currentSession);
    this.currentSession = session;
    this.store.setCurrentSession(id);
    await this.save();
    return this.getSession();
  }

  async setModel(modelId?: string): Promise<void> {
    const normalized = modelId || undefined;
    this.store.setDefaultModel(normalized);

    if (this.currentSession) {
      this.currentSession.model = normalized;
      this.commitSession(this.currentSession);
    }

    await this.save();
  }

  /** The only path for applying session mutations to the store. */
  private commitSession(session: ChatSession): void {
    this.store.updateSession(session);
    if (this.currentSession?.id === session.id) {
      this.currentSession = this.store.getSession(session.id);
    }
  }

  private sessionForWrite(sessionId?: string): ChatSession {
    const session = sessionId ? this.store.getSession(sessionId) : this.currentSession;
    if (!session) throw new Error(`Session ${sessionId} no longer exists`);
    return session;
  }

  async recordUserMessage(
    content: string,
    sessionId?: string,
    action?: "ask" | "explain" | "practice" | "review" | "edit",
  ): Promise<void> {
    const session = this.sessionForWrite(sessionId);
    session.messages.push({
      role: "user",
      content,
      action,
    });
    this.commitSession(session);
    await this.save();
  }

  async setConversationId(conversationId?: string, sessionId?: string): Promise<void> {
    const session = this.sessionForWrite(sessionId);
    session.conversationId = conversationId;
    this.commitSession(session);
    await this.save();
  }

  async recordAssistantMessage(
    content: string,
    sourcePath?: string,
    sessionId?: string,
  ): Promise<void> {
    if (!content.trim()) return;
    const session = this.sessionForWrite(sessionId);
    session.messages.push({
      role: "assistant",
      content,
      sourcePath,
    });
    this.commitSession(session);
    await this.save();
  }

  async recordStructuredPart(
    part: TranscriptPart,
    sourcePath?: string,
    sessionId?: string,
  ): Promise<void> {
    const session = this.sessionForWrite(sessionId);
    if (part.type !== "review-findings" && part.questionId &&
      session.messages.some((message) => message.parts?.some((existing) =>
        existing.type === part.type && existing.questionId === part.questionId))) {
      // A previous write may have failed after staging this item in memory.
      await this.save();
      return;
    }
    session.messages.push({ role: "assistant", content: "", parts: [part], sourcePath });
    this.commitSession(session);
    await this.save();
  }

  /**
   * One durable write for the evaluation and any follow-up question.
   * The store is not mutated if plugin-data persistence fails.
   */
  async recordPracticeOutcome(
    parts: TranscriptPart[],
    operationId: string,
    sourcePath: string,
    sessionId: string,
  ): Promise<TranscriptPart[]> {
    const session = this.sessionForWrite(sessionId);
    const evaluation = parts.find((part) => part.type === "practice-evaluation");
    if (!evaluation || evaluation.type !== "practice-evaluation" ||
      evaluation.operationId !== operationId || !evaluation.questionId) {
      throw new Error("Invalid practice outcome");
    }

    const existing = findCommittedPracticeOutcome(session, evaluation.questionId);
    if (existing) {
      const message = session.messages.find((item) => item.parts?.includes(existing));
      return structuredClone(message?.parts ?? [existing]);
    }

    const next: ChatSession = {
      ...session,
      messages: [...session.messages, {
        role: "assistant",
        content: "",
        parts: structuredClone(parts),
        sourcePath,
      }],
    };
    const staged = this.store.stageSessionUpdate(next);
    try {
      await this.pluginData.update((current) => ({
        ...current,
        ...staged.serialized,
      }));
    } catch (error) {
      throw new PersistenceError("Unable to persist practice outcome", error);
    }
    this.store.acceptPersistedSession(staged.committed);
    if (this.currentSession?.id === sessionId) {
      this.currentSession = this.store.getSession(sessionId);
    }
    return structuredClone(parts);
  }

  async recordProposal(
    proposalId: string,
    proposal: EditProposal,
    mutableFile?: string,
    sessionId?: string,
  ): Promise<void> {
    const session = this.sessionForWrite(sessionId);
    session.messages.push({
      role: "assistant",
      content: "",
      proposalId,
      proposal,
      proposalMutableFile: mutableFile,
      proposalState: "pending",
    });
    this.commitSession(session);
    await this.save();
  }

  getProposal(proposalId: string): {
    proposal: EditProposal;
    mutableFile?: string;
    state: "pending" | "applied" | "rejected" | "stale";
  } | null {
    const message = this.getSession().messages.find(
      (item) => item.proposalId === proposalId,
    );

    if (!message?.proposal) return null;

    return {
      proposal: { ...message.proposal },
      mutableFile: message.proposalMutableFile,
      state: message.proposalState ?? "stale",
    };
  }

  async updateProposalState(
    proposalId: string,
    state: "applied" | "rejected" | "stale",
  ): Promise<void> {
    const session = this.sessionForWrite();
    const message = session.messages.find((item) => item.proposalId === proposalId);
    if (!message || message.proposalState !== "pending") return;

    message.proposalState = state;
    this.commitSession(session);
    await this.save();
  }

  private stalePendingProposals(session: ChatSession | null): void {
    if (!session) return;

    let changed = false;
    for (const message of session.messages) {
      if (message.proposalState !== "pending") continue;
      message.proposalState = "stale";
      changed = true;
    }

    if (changed) {
      this.commitSession(session);
    }
  }

  private async save(): Promise<void> {
    try {
      await this.pluginData.update((current) => ({
        ...current,
        ...this.store.serialize(),
      }));
    } catch (error) {
      throw new PersistenceError("Unable to persist Nox session", error);
    }
  }
}
