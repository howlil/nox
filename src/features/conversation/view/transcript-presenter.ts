import type { ChatMessage } from "../../../../packages/core/src/types";

export interface TranscriptRenderer {
  clear(): void;
  empty(): void;
  user(message: ChatMessage): void;
  assistant(message: ChatMessage, index: number): Promise<void>;
  thinking(message: ChatMessage): void;
  proposal(message: ChatMessage): void;
  structured(message: ChatMessage): void;
  complete(): void;
}

/**
 * Presentation scheduling only. The transcript is an immutable snapshot from
 * the SessionController; this presenter never changes a message or its status.
 * An epoch prevents old session rendering from continuing after navigation.
 */
export class TranscriptPresenter {
  private epoch = 0;
  private restoring = false;

  constructor(private readonly nextFrame: () => Promise<void>) {}

  get isRestoring(): boolean { return this.restoring; }

  cancel(): void {
    this.epoch++;
    this.restoring = false;
  }

  async restore(messages: readonly ChatMessage[], renderer: TranscriptRenderer): Promise<boolean> {
    const epoch = ++this.epoch;
    if (messages.length === 0) {
      this.restoring = false;
      renderer.empty();
      return true;
    }
    renderer.clear();
    this.restoring = true;
    try {
      for (const [index, message] of messages.entries()) {
        if (epoch !== this.epoch) return false;
        if (index > 0 && index % 8 === 0) {
          await this.nextFrame();
          if (epoch !== this.epoch) return false;
        }
        if (message.role === "user") {
          renderer.user(message);
          continue;
        }
        if (message.thought || message.elapsedMs !== undefined) renderer.thinking(message);
        if (message.content.trim()) await renderer.assistant(message, index);
        if (epoch !== this.epoch) return false;
        if (message.proposal) renderer.proposal(message);
        renderer.structured(message);
      }
    } catch (error) {
      // A cancelled restore can reject after navigation/unload when an obsolete
      // Markdown renderer settles. That old failure must not escape into the
      // new session's UI flow; only errors from the current epoch propagate.
      if (epoch !== this.epoch) return false;
      throw error;
    } finally {
      if (epoch === this.epoch) this.restoring = false;
    }
    if (epoch !== this.epoch) return false;
    renderer.complete();
    return true;
  }
}
