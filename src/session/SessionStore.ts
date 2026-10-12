import { ChatSession, ChatMessage, EditProposal } from "../types";
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
  stageSessionUpdate(session: ChatSession): {
    serialized: Record<string, unknown>;
    committed: ChatSession;
  } {
    const next = structuredClone(this.data);
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
    return Object.values(this.data.sessions)
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
      conversationId:
        typeof session.conversationId === "string"
          ? session.conversationId
          : undefined,
      model: typeof session.model === "string" ? session.model : undefined,
      messages: session.messages
        .map((message) => this.decodeMessage(message))
        .filter((message): message is ChatMessage => message !== null),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
