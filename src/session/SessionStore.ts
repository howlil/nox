import { ChatSession, ChatMessage, EditProposal } from "../types";
import { isTranscriptPart } from "./transcript-schema";
import { isPracticeAnswer } from "../domain/practice/question-schema";
import { isLockedLearningMode } from "../domain/practice/learning-scope";

const STORE_KEY = "nox-sessions";
const LEGACY_STORE_KEY = "agy-sessions";
interface StoreData {
  currentSessionId: string | null;
  sessions: Record<string, ChatSession>;
  defaultModel?: string;
}

export interface SessionStoreOptions {
  now?: () => number;
  uuid?: () => string;
}

/**
 * SessionStore — persists sessions to Obsidian plugin data.
 *
 * Spike 5: sessions survive Obsidian restarts.
 * The store is a thin wrapper around plugin.loadData / plugin.saveData.
 */
export class SessionStore {
  private data: StoreData = {
    currentSessionId: null,
    sessions: {},
  };
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor(options: SessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  /** Call once on plugin load. */
  async load(rawData: Record<string, unknown> | null): Promise<void> {
    const stored = rawData?.[STORE_KEY] ?? rawData?.[LEGACY_STORE_KEY];
    if (!stored || typeof stored !== "object") return;

    const candidate = stored as Partial<StoreData>;
    const sessions: Record<string, ChatSession> = {};
    if (candidate.sessions && typeof candidate.sessions === "object") {
      for (const [id, value] of Object.entries(candidate.sessions)) {
        const session = this.decodeSession(value);
        if (session) sessions[id] = session;
      }
    }

    this.data = {
      currentSessionId:
        typeof candidate.currentSessionId === "string"
          ? candidate.currentSessionId
          : null,
      sessions,
      defaultModel:
        typeof candidate.defaultModel === "string"
          ? candidate.defaultModel
          : undefined,
    };
  }

  /**
   * Stage arbitrary session changes against an isolated in-memory draft.
   * The caller publishes the complete snapshot only after plugin-data save
   * succeeds; a rejected save cannot leak new sessions, messages, or defaults.
   */
  stageTransaction<T>(mutate: (draft: SessionStore) => T): {
    serialized: Record<string, unknown>;
    result: T;
    publish: () => void;
  } {
    const draft = new SessionStore({ now: this.now, uuid: this.uuid });
    draft.data = structuredClone(this.data);
    const result = mutate(draft);
    return {
      serialized: draft.serialize(),
      result,
      // The staged draft is private to this transaction. Publish it after
      // durable save instead of cloning the entire transcript a third time.
      publish: () => { this.data = draft.data; },
    };
  }

  /** Serialize to plugin data object. */
  serialize(): Record<string, unknown> {
    return { [STORE_KEY]: structuredClone(this.data) };
  }

  // ── Session CRUD ─────────────────────────────────────────────────────────

  createSession(model?: string): ChatSession {
    const now = this.now();
    const session: ChatSession = {
      id: this.uuid(),
      model,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.data.sessions[session.id] = session;
    this.data.currentSessionId = session.id;
    return structuredClone(session);
  }

  getSession(id: string): ChatSession | null {
    const session = this.data.sessions[id];
    return session ? structuredClone(session) : null;
  }

  getCurrentSession(): ChatSession | null {
    if (!this.data.currentSessionId) return null;
    return this.getSession(this.data.currentSessionId);
  }

  /**
   * Build the next durable snapshot without modifying the live store.
   * The caller publishes it to memory only after saveData succeeds.
   */
  stageSessionUpdate(session: ChatSession, defaults?: { model?: string }): {
    serialized: Record<string, unknown>;
    committed: ChatSession;
  } {
    const next = structuredClone(this.data);
    if (defaults) next.defaultModel = defaults.model;
    const committed = { ...structuredClone(session), updatedAt: this.now() };
    next.sessions[session.id] = committed;
    return { serialized: { [STORE_KEY]: next }, committed };
  }

  acceptPersistedSession(session: ChatSession): void {
    this.data.sessions[session.id] = structuredClone(session);
  }

  updateSession(session: ChatSession): void {
    this.data.sessions[session.id] = { ...structuredClone(session), updatedAt: this.now() };
  }

  setCurrentSession(id: string): void {
    const session = this.data.sessions[id];
    if (!session || session.archivedAt) throw new Error("Cannot select a missing or archived session");
    this.data.currentSessionId = id;
  }

  /** Mutations are made only on a staged copy owned by SessionController. */
  archiveSessions(ids: string[], archived: boolean): number {
    let changed = 0;
    const now = this.now();
    for (const id of new Set(ids)) {
      const session = this.data.sessions[id];
      if (!session || Boolean(session.archivedAt) === archived) continue;
      if (archived) {
        session.archivedAt = now;
        // An archived thread must never keep an actionable pending note edit.
        for (const message of session.messages) {
          if (message.proposalState === "pending") message.proposalState = "stale";
        }
      } else delete session.archivedAt;
      changed++;
    }
    this.ensureActiveSession();
    return changed;
  }

  deleteSessions(ids: string[]): number {
    let deleted = 0;
    for (const id of new Set(ids)) {
      if (!this.data.sessions[id]) continue;
      delete this.data.sessions[id];
      deleted++;
    }
    this.ensureActiveSession();
    return deleted;
  }

  private ensureActiveSession(): void {
    const current = this.data.currentSessionId && this.data.sessions[this.data.currentSessionId];
    if (current && !current.archivedAt) return;
    const fallback = Object.values(this.data.sessions)
      .filter(session => !session.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (fallback) this.data.currentSessionId = fallback.id;
    else this.createSession(this.data.defaultModel);
  }

  // ── Model preference ─────────────────────────────────────────────────────

  getDefaultModel(): string | undefined {
    return this.data.defaultModel;
  }

  setDefaultModel(model?: string): void {
    this.data.defaultModel = model || undefined;
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  /** All sessions, newest first. */
  listSessions(includeArchived = false): ChatSession[] {
    return Object.values(this.data.sessions)
      .filter(session => includeArchived || !session.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => structuredClone(session));
  }

  /**
   * Decode every field individually. Never spread untrusted plugin data into a
   * persisted message or pass malformed edit proposals into the UI.
   */
  private decodeMessage(value: unknown): ChatMessage | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    if ((raw.role !== "user" && raw.role !== "assistant") ||
      typeof raw.content !== "string") return null;

    const message: ChatMessage = {
      role: raw.role,
      content: raw.content,
    };
    if (typeof raw.sourcePath === "string") message.sourcePath = raw.sourcePath;
    if (["ask", "explain", "practice", "review", "edit"].includes(String(raw.action))) {
      message.action = raw.action as ChatMessage["action"];
    }
    if (Array.isArray(raw.parts)) {
      message.parts = raw.parts.filter(isTranscriptPart).map((part) => structuredClone(part));
    }
    if (typeof raw.thought === "string" && raw.thought.trim()) {
      message.thought = raw.thought.trim();
    }
    if (typeof raw.elapsedMs === "number" && Number.isFinite(raw.elapsedMs) && raw.elapsedMs >= 0) {
      message.elapsedMs = raw.elapsedMs;
    }
    if (raw.metrics && typeof raw.metrics === "object" && !Array.isArray(raw.metrics)) {
      const item = raw.metrics as Record<string, unknown>;
      const finite = (key: string) => typeof item[key] === "number" &&
        Number.isFinite(item[key]) && (item[key] as number) >= 0;
      const numbers = ["estimatedInputTokens", "estimatedContextTokens",
        "estimatedHistoryTokens", "shortenedSources", "retrievedChunks", "elapsedMs"];
      if (numbers.every(finite) && typeof item.compacted === "boolean") {
        const metrics: NonNullable<ChatMessage["metrics"]> = {
          estimatedInputTokens: item.estimatedInputTokens as number,
          estimatedContextTokens: item.estimatedContextTokens as number,
          estimatedHistoryTokens: item.estimatedHistoryTokens as number,
          shortenedSources: item.shortenedSources as number,
          retrievedChunks: item.retrievedChunks as number,
          elapsedMs: item.elapsedMs as number,
          compacted: item.compacted,
        };
        if (finite("firstTokenMs")) metrics.firstTokenMs = item.firstTokenMs as number;
        if (finite("contextMs")) metrics.contextMs = item.contextMs as number;
        if (finite("preparationMs")) metrics.preparationMs = item.preparationMs as number;
        if (finite("firstVisibleMs")) metrics.firstVisibleMs = item.firstVisibleMs as number;
        if (finite("providerInputTokens")) metrics.providerInputTokens = item.providerInputTokens as number;
        if (finite("providerOutputTokens")) metrics.providerOutputTokens = item.providerOutputTokens as number;
        message.metrics = metrics;
      }
    }

    // Decode bounded response alternatives independently; malformed metadata must
    // never hide or corrupt a valid canonical assistant message.
    if (raw.role === "assistant" && Array.isArray(raw.responseVersions) &&
        raw.responseVersions.length >= 2 && raw.responseVersions.length <= 8 &&
        Number.isInteger(raw.responseVersionIndex)) {
      const versions = raw.responseVersions.map(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const item = value as Record<string, unknown>;
        if (typeof item.content !== "string" || !item.content.trim()) return null;
        if (item.sourcePath !== undefined && typeof item.sourcePath !== "string") return null;
        return { content: item.content,
          ...(typeof item.sourcePath === "string" ? { sourcePath: item.sourcePath } : {}),
          ...(typeof item.thought === "string" ? { thought: item.thought } : {}),
          ...(typeof item.elapsedMs === "number" && Number.isFinite(item.elapsedMs) &&
              item.elapsedMs >= 0 ? { elapsedMs: item.elapsedMs } : {}) };
      });
      const index = raw.responseVersionIndex as number;
      if (versions.every(version => version !== null) && index >= 0 &&
          index < versions.length && versions[index]?.content === message.content) {
        message.responseVersions = versions as NonNullable<ChatMessage["responseVersions"]>;
        message.responseVersionIndex = index;
      }
    }

    if (raw.role === "assistant" && raw.proposal && typeof raw.proposal === "object") {
      const proposal = raw.proposal as Record<string, unknown>;
      if (typeof proposal.file === "string" &&
        typeof proposal.original === "string" &&
        typeof proposal.replacement === "string" &&
        (proposal.reason === undefined || typeof proposal.reason === "string")) {
        const decoded: EditProposal = {
          file: proposal.file,
          original: proposal.original,
          replacement: proposal.replacement,
        };
        if (typeof proposal.reason === "string") decoded.reason = proposal.reason;
        message.proposal = decoded;
        if (typeof raw.proposalId === "string") message.proposalId = raw.proposalId;
        if (typeof raw.proposalMutableFile === "string") {
          message.proposalMutableFile = raw.proposalMutableFile;
        }
        message.proposalState = ["applied", "rejected", "stale"].includes(String(raw.proposalState))
          ? raw.proposalState as "applied" | "rejected" | "stale"
          : "stale";
      }
    }

    return message;
  }

  private decodeSession(value: unknown): ChatSession | null {
    if (!value || typeof value !== "object") return null;
    const session = value as Partial<ChatSession>;
    if (
      typeof session.id !== "string" ||
      !Array.isArray(session.messages) ||
      typeof session.createdAt !== "number" ||
      typeof session.updatedAt !== "number"
    ) {
      return null;
    }

    return {
      id: session.id,
      archivedAt: typeof session.archivedAt === "number" &&
        Number.isFinite(session.archivedAt) && session.archivedAt > 0
        ? session.archivedAt : undefined,
      runtimeProvider: typeof session.runtimeProvider === "string" ? session.runtimeProvider : undefined,
      learningScope: session.learningScope &&
        (session.learningScope.mode === "FREE" || isLockedLearningMode(session.learningScope.mode))
        ? { mode: session.learningScope.mode,
            ...(session.learningScope.mode === "FREE" && isLockedLearningMode(session.learningScope.resumeMode)
              ? { resumeMode: session.learningScope.resumeMode } : {}) }
        : undefined,
      conversationId:
        typeof session.conversationId === "string"
          ? session.conversationId
          : undefined,
      model: typeof session.model === "string" ? session.model : undefined,
      practiceDrafts: session.practiceDrafts && typeof session.practiceDrafts === "object" &&
        !Array.isArray(session.practiceDrafts)
        ? Object.fromEntries(Object.entries(session.practiceDrafts)
            .filter(([key, value]) => key.length > 0 && key.length <= 200 && isPracticeAnswer(value)))
        : undefined,
      messages: session.messages
        .map((message) => this.decodeMessage(message))
        .filter((message): message is ChatMessage => message !== null),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
