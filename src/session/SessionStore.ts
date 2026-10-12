import { ChatSession } from "../types";
import { isTranscriptPart } from "./transcript-schema";

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

  /** Serialize to plugin data object. */
  serialize(): Record<string, unknown> {
    return { [STORE_KEY]: this.data };
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
    return session;
  }

  getSession(id: string): ChatSession | null {
    return this.data.sessions[id] ?? null;
  }

  getCurrentSession(): ChatSession | null {
    if (!this.data.currentSessionId) return null;
    return this.getSession(this.data.currentSessionId);
  }

  updateSession(session: ChatSession): void {
    session.updatedAt = this.now();
    this.data.sessions[session.id] = session;
  }

  setCurrentSession(id: string): void {
    this.data.currentSessionId = id;
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
  listSessions(): ChatSession[] {
    return Object.values(this.data.sessions).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
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
      conversationId:
        typeof session.conversationId === "string"
          ? session.conversationId
          : undefined,
      model: typeof session.model === "string" ? session.model : undefined,
      messages: session.messages
        .filter((message) => {
          if (!message || typeof message !== "object") return false;
          const candidate = message as { role?: unknown; content?: unknown };
          return (
            (candidate.role === "user" || candidate.role === "assistant") &&
            typeof candidate.content === "string"
          );
        })
        .map((message) => ({
          ...message,
          parts: Array.isArray(message.parts)
            ? message.parts.filter(isTranscriptPart)
            : undefined,
          proposalState:
            message.proposalState === "pending"
              ? "stale"
              : message.proposalState,
        })),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
