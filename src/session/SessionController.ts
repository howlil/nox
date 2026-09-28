import { SessionStore } from "./SessionStore";
import { PluginDataRepository } from "../persistence/PluginDataRepository";
import {
  AgentAdapter,
  AgentHealth,
  AgentContext,
  AgentInput,
  AgentModel,
  AgentStreamEvent,
  ChatSession,
} from "../types";

/**
 * Owns chat/agent conversation persistence only.
 *
 * Learning orchestration, context resolution, and Markdown mutation live above
 * or beside this class. This keeps session state independent of Learning OS
 * behavior.
 */
export class SessionController {
  private currentSession: ChatSession | null = null;
  private models: AgentModel[] = [];

  constructor(
    private readonly pluginData: PluginDataRepository,
    private readonly store: SessionStore,
    private readonly adapter: AgentAdapter,
  ) {}

  async init(): Promise<void> {
    const data = await this.pluginData.read();
    await this.store.load(data);

    this.currentSession = this.store.getCurrentSession();
    if (!this.currentSession) {
      this.currentSession = this.store.createSession(this.store.getDefaultModel());
    }

    try {
      this.models = await this.adapter.listModels();
    } catch {
      this.models = [];
    }
  }

  checkRuntime(): Promise<AgentHealth> {
    return this.adapter.check();
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

  setModel(modelId?: string): void {
    const normalized = modelId || undefined;
    this.store.setDefaultModel(normalized);

    if (this.currentSession) {
      this.currentSession.model = normalized;
      this.store.updateSession(this.currentSession);
      void this.save();
    }
  }

  getModels(): AgentModel[] {
    return this.models;
  }

  /**
   * Execute one prepared agent turn.
   *
   * Context is already resolved by LearningController. displayPrompt is the raw
   * user text stored in local history so internal learning instructions do not
   * leak into the visible/session transcript.
   */
  async *sendTurn(
    prompt: string,
    context: AgentContext[],
    displayPrompt: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    const session = this.getSession();
    const input: AgentInput = { prompt, context };

    session.messages.push({
      role: "user",
      content: displayPrompt,
    });

    this.store.updateSession(session);
    await this.save();

    for await (const event of this.adapter.send(input, {
      model: session.model,
      conversationId: session.conversationId,
    }, signal)) {
      if (event.type === "completed" && event.conversationId) {
        session.conversationId = event.conversationId;
      }

      yield event;
    }

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
    proposal: import("../types").EditProposal,
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
