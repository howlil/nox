import { SessionStore } from "./SessionStore";
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
    return this.currentSession;
  }

  async newSession(): Promise<ChatSession> {
    const model = this.currentSession?.model ?? this.store.getDefaultModel();
    this.currentSession = this.store.createSession(model);
    await this.save();
    return this.currentSession;
  }

  listSessions(): ChatSession[] {
    return this.store.listSessions();
  }

  async selectSession(id: string): Promise<ChatSession | null> {
    const session = this.store.getSession(id);
    if (!session) return null;

    this.currentSession = session;
    this.store.setCurrentSession(id);
    await this.save();
    return session;
  }

  async setModel(modelId?: string): Promise<void> {
    const normalized = modelId || undefined;
    this.store.setDefaultModel(normalized);

    if (this.currentSession) {
      this.currentSession.model = normalized;
      this.store.updateSession(this.currentSession);
    }

    await this.save();
  }

  async recordUserMessage(content: string): Promise<void> {
    const session = this.getSession();
    session.messages.push({
      role: "user",
      content,
    });
    this.store.updateSession(session);
    await this.save();
  }

  async setConversationId(conversationId?: string): Promise<void> {
    const session = this.getSession();
    session.conversationId = conversationId;
    this.store.updateSession(session);
    await this.save();
  }

  async recordAssistantMessage(
    content: string,
    sourcePath?: string,
  ): Promise<void> {
    if (!content.trim()) return;
    const session = this.getSession();
    session.messages.push({
      role: "assistant",
      content,
      sourcePath,
    });
    this.store.updateSession(session);
    await this.save();
  }

  async recordProposal(
    proposalId: string,
    proposal: EditProposal,
  ): Promise<void> {
    const session = this.getSession();
    session.messages.push({
      role: "assistant",
      content: "",
      proposalId,
      proposal,
      proposalState: "pending",
    });
    this.store.updateSession(session);
    await this.save();
  }

  async updateProposalState(
    proposalId: string,
    state: "applied" | "rejected" | "stale",
  ): Promise<void> {
    const message = this.getSession().messages.find(
      (item) => item.proposalId === proposalId,
    );
    if (!message) return;
    message.proposalState = state;
    this.store.updateSession(this.getSession());
    await this.save();
  }

  private async save(): Promise<void> {
    await this.pluginData.update((current) => ({
      ...current,
      ...this.store.serialize(),
    }));
  }
}
