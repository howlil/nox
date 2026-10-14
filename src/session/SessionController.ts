import { SessionStore } from "./SessionStore";
import { PersistenceError } from "../persistence/PersistenceError";
import { findCommittedPracticeOutcome, findCommittedReview, type TranscriptPart } from "./transcript-types";
import { PluginDataRepository } from "../persistence/PluginDataRepository";
import type { LearningScopeState } from "../domain/practice/learning-scope";
import type { PracticeAnswer } from "../domain/practice/types";
import { isPracticeAnswer } from "../domain/practice/question-schema";
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
  private runtimeProvider?: string;
  // All session mutations—including snapshot staging and disk writes—have
  // one legal ordering. PluginDataRepository only serializes the I/O itself.
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly pluginData: PluginDataRepository,
    private readonly store: SessionStore,
  ) {}

  async init(): Promise<void> {
    const data = await this.pluginData.read();
    await this.store.load(data);

    // One-time legacy migration. Only compact a fully decodable, selected
    // conversation; leave malformed legacy data intact for safe recovery.
    const legacy = data["agy-sessions"];
    if (data["nox-sessions"] == null && legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      const rawSessions = (legacy as { sessions?: unknown }).sessions;
      const keys = rawSessions && typeof rawSessions === "object" && !Array.isArray(rawSessions)
        ? Object.keys(rawSessions) : [];
      if (keys.length > 0 && this.store.listSessions().length === keys.length &&
          this.store.getCurrentSession()) {
        const normalized = this.store.serialize();
        const original = JSON.stringify(legacy);
        try {
          await this.pluginData.update((current) => {
            // Never overwrite a concurrent canonical migration or changed legacy snapshot.
            if (current["nox-sessions"] != null) return current;
            if (JSON.stringify(current["agy-sessions"]) !== original) {
              throw new Error("Legacy sessions changed during migration.");
            }
            const next = { ...current, ...normalized };
            delete next["agy-sessions"];
            return next;
          });
        } catch (error) {
          throw new PersistenceError("Unable to migrate legacy Nox sessions", error);
        }
      }
    }

    this.currentSession = this.store.getCurrentSession();
    if (!this.currentSession) {
      this.currentSession = this.store.createSession(this.store.getDefaultModel());
    }
  }

  getSession(): ChatSession {
    if (!this.currentSession) throw new Error("Session not initialized");
    return structuredClone(this.currentSession);
  }

  /** Bind cursor/model compatibility without changing the canonical transcript. */
  async configureRuntime(provider: string, preferredModel?: string, options: {
    updateModel?: boolean;
    updateData?: (current: Record<string, unknown>) => Record<string, unknown>;
  } = {}): Promise<void> {
    return this.serializeWrite(async () => {
      const current = this.sessionForWrite();
      const changed = (current.runtimeProvider ?? "agy") !== provider;
      const changeModel = changed || options.updateModel;
      const model = changeModel ? preferredModel : this.store.getDefaultModel();
      const next = { ...current, runtimeProvider: provider,
        ...(changed ? { conversationId: undefined } : {}),
        ...(changeModel ? { model: preferredModel } : {}) };
      const staged = this.store.stageSessionUpdate(next, { model });
      try {
        await this.pluginData.update((data) => ({ ...(options.updateData?.(data) ?? data), ...staged.serialized }));
      } catch (error) { throw new PersistenceError("Unable to persist runtime selection", error); }
      this.store.acceptPersistedSession(staged.committed);
      this.store.setDefaultModel(model);
      this.currentSession = this.store.getSession(current.id);
      this.runtimeProvider = provider;
    });
  }

  private forRuntime(session: ChatSession): ChatSession {
    if (!this.runtimeProvider) return session;
    return { ...session, runtimeProvider: this.runtimeProvider,
      ...((session.runtimeProvider ?? "agy") !== this.runtimeProvider
        ? { conversationId: undefined, model: this.store.getDefaultModel() } : {}) };
  }


  async newSession(): Promise<ChatSession> {
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction((draft) => {
        const previous = this.currentSession && draft.getSession(this.currentSession.id);
        if (previous) {
          for (const message of previous.messages) {
            if (message.proposalState === "pending") message.proposalState = "stale";
          }
          draft.updateSession(previous);
        }
        const model = previous?.model ?? draft.getDefaultModel();
        const next = this.forRuntime(draft.createSession(model));
        draft.updateSession(next);
      });
      return this.getSession();
    });
  }

  listSessions(includeArchived = false): ChatSession[] {
    return this.store.listSessions(includeArchived);
  }

  async mutateHistory(ids: string[], action: "archive" | "restore" | "delete"): Promise<{
    affected: number;
    activeSessionChanged: boolean;
  }> {
    return this.serializeWrite(async () => {
      const before = this.currentSession?.id;
      const affected = await this.commitStoreTransaction(draft => {
        const count = action === "delete" ? draft.deleteSessions(ids)
          : draft.archiveSessions(ids, action === "archive");
        // A fallback selected implicitly by archive/delete must use the
        // configured runtime, just like an explicit selectSession call.
        const fallback = draft.getCurrentSession();
        if (fallback && fallback.id !== before) {
          for (const message of fallback.messages) {
            if (message.proposalState === "pending") message.proposalState = "stale";
          }
          draft.updateSession(this.forRuntime(fallback));
        }
        return count;
      });
      return { affected, activeSessionChanged: before !== this.currentSession?.id };
    });
  }


  async selectSession(id: string): Promise<ChatSession | null> {
    return this.serializeWrite(async () => {
      if (!this.store.getSession(id) || this.store.getSession(id)?.archivedAt) return null;
      await this.commitStoreTransaction((draft) => {
        const previous = this.currentSession && draft.getSession(this.currentSession.id);
        if (previous) {
          for (const message of previous.messages) {
            if (message.proposalState === "pending") message.proposalState = "stale";
          }
          draft.updateSession(previous);
        }
        const stored = draft.getSession(id);
        if (!stored) throw new Error(`Session ${id} no longer exists`);
        const selected = this.forRuntime(stored);
        if (selected.runtimeProvider !== stored.runtimeProvider ||
            selected.conversationId !== stored.conversationId ||
            selected.model !== stored.model) draft.updateSession(selected);
        draft.setCurrentSession(id);
      });
      return this.getSession();
    });
  }


  async setModel(modelId?: string): Promise<void> {
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction((draft) => {
        const normalized = modelId || undefined;
        draft.setDefaultModel(normalized);
        const active = draft.getCurrentSession();
        if (active) {
          active.model = normalized;
          draft.updateSession(active);
        }
      });
    });
  }

  /** Save a whole isolated session draft before publishing any of its state. */
  private async commitStoreTransaction<T>(mutate: (draft: SessionStore) => T): Promise<T> {
    const staged = this.store.stageTransaction(mutate);
    try {
      await this.pluginData.update((current) => ({ ...current, ...staged.serialized }));
    } catch (error) {
      throw new PersistenceError("Unable to persist Nox session", error);
    }
    staged.publish();
    this.currentSession = this.store.getCurrentSession();
    return staged.result;
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
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction((draft) => {
        const session = sessionId ? draft.getSession(sessionId) : draft.getCurrentSession();
        if (!session) throw new Error(`Session ${sessionId} no longer exists`);
        session.messages.push({ role: "user", content, action });
        draft.updateSession(session);
      });
    });
  }

  /** Commit both hint messages before the caller marks the attempt assisted. */
  async recordPracticeHint(hint: string, sessionId: string): Promise<void> {
    if (!hint.trim()) throw new Error("Cannot persist an empty practice hint.");
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction((draft) => {
        const session = draft.getSession(sessionId);
        if (!session) throw new Error("Practice session no longer exists.");
        session.messages.push(
          { role: "user", content: "/hint", action: "practice" },
          { role: "assistant", content: "Hint: " + hint },
        );
        draft.updateSession(session);
      });
    });
  }

  /** Draft changes use the existing serialized session writer, not a separate store. */
  async savePracticeDraft(questionId: string, answer: PracticeAnswer, sessionId?: string): Promise<void> {
    if (!questionId || !isPracticeAnswer(answer)) throw new Error("Invalid practice draft.");
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction(draft => {
        const session = sessionId ? draft.getSession(sessionId) : draft.getCurrentSession();
        if (!session) throw new Error("Practice session no longer exists.");
        const question = session.messages.some(m => m.parts?.some(p =>
          p.type === "practice-question" && p.questionId === questionId));
        const graded = session.messages.some(m => m.parts?.some(p =>
          p.type === "practice-evaluation" && p.questionId === questionId));
        if (!question || graded) throw new Error("Practice question is no longer answerable.");
        session.practiceDrafts = { ...session.practiceDrafts, [questionId]: structuredClone(answer) };
        draft.updateSession(session);
      });
    });
  }

  /** Publish the lock and its acknowledgement only after one durable write. */
  async recordScopeChange(
    state: LearningScopeState, command: string, reply: string, sessionId: string,
  ): Promise<void> {
    return this.serializeWrite(async () => {
      const session = this.sessionForWrite(sessionId);
      const next: ChatSession = {
        ...session, learningScope: structuredClone(state),
        // Provider conversations may contain instructions from the previous mode.
        conversationId: undefined,
        messages: [...session.messages,
          { role: "user", content: command, action: "ask" },
          { role: "assistant", content: reply }],
      };
      const staged = this.store.stageSessionUpdate(next);
      try {
        await this.pluginData.update((current) => ({ ...current, ...staged.serialized }));
      } catch (error) {
        throw new PersistenceError("Unable to persist learning mode", error);
      }
      this.store.acceptPersistedSession(staged.committed);
      if (this.currentSession?.id === sessionId) this.currentSession = this.store.getSession(sessionId);
    });
  }


  async setConversationId(conversationId?: string, sessionId?: string): Promise<void> {
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction((draft) => {
        const session = sessionId ? draft.getSession(sessionId) : draft.getCurrentSession();
        if (!session) throw new Error(`Session ${sessionId} no longer exists`);
        session.conversationId = conversationId;
        draft.updateSession(session);
      });
    });
  }

  async recordAssistantMessage(
    content: string,
    sourcePath?: string,
    sessionId?: string,
    thought?: string,
    elapsedMs?: number,
    metrics?: import("../types").AgentTurnMetrics,
  ): Promise<void> {
    if (!content.trim() && !thought?.trim()) return;
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction((draft) => {
        const session = sessionId ? draft.getSession(sessionId) : draft.getCurrentSession();
        if (!session) throw new Error(`Session ${sessionId} no longer exists`);
        session.messages.push({
          role: "assistant",
          content,
          sourcePath,
          ...(thought?.trim() ? { thought: thought.trim() } : {}),
          ...(typeof elapsedMs === "number" ? { elapsedMs } : {}),
          ...(metrics ? { metrics: structuredClone(metrics) } : {}),
        });
        draft.updateSession(session);
      });
    });
  }


  /**
   * Replace only the most recent plain assistant answer, atomically preserving
   * up to eight alternatives. A failed model request never enters this writer.
   */
  async recordRegeneratedResponse(
    messageIndex: number,
    expectedContent: string,
    replacement: import("../types").ResponseVersion,
    sessionId: string,
    conversationId?: string,
    metrics?: import("../types").AgentTurnMetrics,
  ): Promise<void> {
    if (!replacement.content.trim()) throw new Error("Cannot save an empty regeneration.");
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction(draft => {
        const session = draft.getSession(sessionId);
        if (!session) throw new Error("Regeneration session no longer exists.");
        const message = session.messages[messageIndex];
        const prompt = session.messages[messageIndex - 1];
        if (messageIndex !== session.messages.length - 1 ||
            message?.role !== "assistant" || message.content !== expectedContent ||
            message.proposal || message.parts?.length ||
            prompt?.role !== "user" ||
            (prompt.action !== "ask" && prompt.action !== "explain")) {
          throw new Error("Response changed during regeneration. Original answer preserved.");
        }
        const previous = message.responseVersions?.length
          ? [...message.responseVersions]
          : [{ content: message.content, sourcePath: message.sourcePath,
              thought: message.thought, elapsedMs: message.elapsedMs }];
        const versions = [...previous, structuredClone(replacement)].slice(-8);
        session.messages[messageIndex] = {
          ...message,
          content: replacement.content,
          sourcePath: replacement.sourcePath,
          thought: replacement.thought,
          elapsedMs: replacement.elapsedMs,
          metrics,
          responseVersions: versions,
          responseVersionIndex: versions.length - 1,
        };
        // Opaque provider cursor is only valid for this newly generated branch.
        session.conversationId = conversationId;
        draft.updateSession(session);
      });
    });
  }

  /** Selection is persisted in the canonical transcript, never only in DOM. */
  async selectResponseVersion(
    messageIndex: number, versionIndex: number, sessionId: string,
  ): Promise<void> {
    return this.serializeWrite(async () => {
      await this.commitStoreTransaction(draft => {
        const session = draft.getSession(sessionId);
        if (!session) throw new Error("Response session no longer exists.");
        const message = session.messages[messageIndex];
        const version = message?.responseVersions?.[versionIndex];
        if (message?.role !== "assistant" || message.proposal || message.parts?.length ||
            !version || !Number.isInteger(versionIndex)) {
          throw new Error("Response version is unavailable.");
        }
        session.messages[messageIndex] = {
          ...message,
          content: version.content,
          sourcePath: version.sourcePath,
          thought: version.thought,
          elapsedMs: version.elapsedMs,
          responseVersionIndex: versionIndex,
        };
        // Switching branch invalidates opaque provider-owned conversation state.
        session.conversationId = undefined;
        draft.updateSession(session);
      });
    });
  }

  async recordStructuredPart(
    part: TranscriptPart,
    sourcePath?: string,
    sessionId?: string,
  ): Promise<void> {
    return this.serializeWrite(async () => {
      const session = this.sessionForWrite(sessionId);
      if (part.type !== "review-findings" && part.questionId &&
        session.messages.some((message) => message.parts?.some((existing) =>
          existing.type === part.type && existing.questionId === part.questionId))) {
        // A previous write may have failed after staging this item in memory.
        await this.save();
        return;
      }
      await this.persistOutcome(session, [part], sourcePath);
    });
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
    return this.serializeWrite(async () => {
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

      // The evaluation and draft deletion belong to the same durable snapshot.
      const next = { ...session, practiceDrafts: { ...session.practiceDrafts } };
      delete next.practiceDrafts[evaluation.questionId];
      await this.persistOutcome(next, parts, sourcePath);
      return structuredClone(parts);
    });
  }

  async recordReviewOutcome(
    part: Extract<TranscriptPart, { type: "review-findings" }>,
    sourcePath: string,
    sessionId: string,
  ): Promise<Extract<TranscriptPart, { type: "review-findings" }>> {
    return this.serializeWrite(async () => {
      if (!part.reviewId) throw new Error("Review outcome requires stable reviewId");
      const session = this.sessionForWrite(sessionId);
      const existing = findCommittedReview(session, part.reviewId);
      if (existing) return structuredClone(existing);
      await this.persistOutcome(session, [part], sourcePath);
      return structuredClone(part);
    });
  }

  /** Keep in-memory session transitions and durable snapshots in the same order.
   * Idempotency checks run only after the previous session write has finished.
   */
  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation);
    this.writeTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persistOutcome(
    session: ChatSession,
    parts: TranscriptPart[],
    sourcePath?: string,
  ): Promise<void> {
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
      throw new PersistenceError("Unable to persist learning outcome", error);
    }
    this.store.acceptPersistedSession(staged.committed);
    if (this.currentSession?.id === session.id) {
      this.currentSession = this.store.getSession(session.id);
    }
  }


  /** An entire completed edit outcome is one durable transcript decision. */
  async recordEditOutcome(
    proposalId: string,
    proposal: EditProposal,
    narrative: string,
    mutableFile: string,
    sessionId: string,
  ): Promise<{ proposal: EditProposal; state: "pending" | "applied" | "rejected" | "stale" }> {
    return this.serializeWrite(async () => {
      if (proposal.file !== mutableFile) {
        throw new Error("Edit target must match the authorized mutable note.");
      }
      const session = this.sessionForWrite(sessionId);
      const existing = session.messages.find((message) => message.proposalId === proposalId);
      if (existing?.proposal) {
        return {
          proposal: structuredClone(existing.proposal),
          state: existing.proposalState ?? "stale",
        };
      }
      const next: ChatSession = {
        ...session,
        messages: [
          ...session.messages,
          ...(narrative.trim() ? [{
            role: "assistant" as const, content: narrative, sourcePath: mutableFile,
          }] : []),
          {
            role: "assistant", content: "", proposalId,
            proposal: structuredClone(proposal), proposalMutableFile: mutableFile,
            proposalState: "pending",
          },
        ],
      };
      const staged = this.store.stageSessionUpdate(next);
      try {
        await this.pluginData.update((current) => ({
          ...current,
          ...staged.serialized,
        }));
      } catch (error) {
        throw new PersistenceError("Unable to persist edit proposal", error);
      }
      this.store.acceptPersistedSession(staged.committed);
      if (this.currentSession?.id === session.id) {
        this.currentSession = this.store.getSession(session.id);
      }
      return { proposal: structuredClone(proposal), state: "pending" as const };
    });
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
    sessionId?: string,
  ): Promise<void> {
    return this.serializeWrite(async () => {
      const session = this.sessionForWrite(sessionId);
      const message = session.messages.find((item) => item.proposalId === proposalId);
      if (!message || message.proposalState !== "pending") return;

      // Do not publish a settled proposal in memory until disk confirms it.
      // Apply may have already mutated the editor; failed status writes must
      // remain retryable, without losing the canonical pending record.
      const next: ChatSession = {
        ...session,
        messages: session.messages.map((item) =>
          item.proposalId === proposalId ? { ...item, proposalState: state } : item),
      };
      const staged = this.store.stageSessionUpdate(next);
      try {
        await this.pluginData.update((current) => ({
          ...current,
          ...staged.serialized,
        }));
      } catch (error) {
        throw new PersistenceError("Unable to persist proposal status", error);
      }
      this.store.acceptPersistedSession(staged.committed);
      if (this.currentSession?.id === session.id) {
        this.currentSession = this.store.getSession(session.id);
      }
    });
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
