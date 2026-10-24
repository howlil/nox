import {
  AgentAdapter,
  AgentHealth,
  AgentInput,
  AgentModel,
  AgentStreamEvent,
  SendOptions,
  TokenUsage,
  type AgentRuntimePort,
} from "../types";

export type { AgentRuntimePort } from "../types";

/**
 * Owns runtime lifecycle and runtime-derived state.
 *
 * Conversation/session history is intentionally not represented here.
 */
export class AgentRuntime implements AgentRuntimePort {
  private models: AgentModel[] = [];
  private modelDiscoveryError?: string;
  private discovery?: AbortController;
  private usageTrackingError?: string;

  constructor(private adapter: AgentAdapter,
    private readonly onUsage?: (usage: TokenUsage, model: string | undefined, metadata: {
      conversationId?: string; cumulative?: boolean; turnCount?: number;
      freshConversation?: boolean;
    }) => Promise<void>) {}

  async replaceAdapter(adapter: AgentAdapter): Promise<void> {
    // Provider changes only invalidate model state. Never execute a CLI during
    // settings persistence or restore models from the previous provider.
    this.discovery?.abort();
    this.discovery = undefined;
    this.adapter = adapter;
    this.models = [];
    this.modelDiscoveryError = undefined;
  }

  async init(): Promise<void> {
    this.discovery?.abort();
    const discovery = this.discovery = new AbortController();
    const adapter = this.adapter;
    this.modelDiscoveryError = undefined;
    try {
      const models = await adapter.listModels(discovery.signal);
      if (this.discovery === discovery && !discovery.signal.aborted) {
        this.models = models;
        if (models.length === 0) this.modelDiscoveryError = "No models available for the current provider.";
      }
    } catch (error) {
      if (this.discovery === discovery && !discovery.signal.aborted) {
        this.models = [];
        // The ChatGPT adapter raises sanitized errors without credentials.
        this.modelDiscoveryError = error instanceof Error ? error.message : "Model discovery failed.";
      }
    } finally {
      if (this.discovery === discovery) this.discovery = undefined;
    }
  }

  dispose(): void {
    this.discovery?.abort();
    this.discovery = undefined;
  }

  check(): Promise<AgentHealth> {
    return this.adapter.check();
  }

  getModels(): AgentModel[] {
    return this.models.map((model) => ({ ...model }));
  }

  supportsSourceIsolation(): boolean {
    return this.adapter.sourceIsolation === "no-filesystem-tools";
  }

  getModelDiscoveryError(): string | undefined { return this.modelDiscoveryError; }

  refreshModels(): Promise<void> { return this.init(); }

  getUsageTrackingError(): string | undefined { return this.usageTrackingError; }

  async *send(
    input: AgentInput,
    opts: SendOptions,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    const adapter = this.adapter;
    for await (const event of adapter.send(input, opts, signal)) {
      // Telemetry is a runtime side effect, not a learning event. Persist it even
      // when the subsequent structured learning response is rejected.
      if (event.type === "usage") {
        if (this.onUsage) {
          try {
            await this.onUsage(event.usage, event.model ??
              (opts.model ? "requested: " + opts.model : undefined), {
              conversationId: event.conversationId,
              cumulative: event.cumulative,
              turnCount: event.turnCount,
              freshConversation: !opts.conversationId,
            });
            this.usageTrackingError = undefined;
          } catch {
            this.usageTrackingError = "Usage could not be saved. Check plugin data storage.";
          }
        }
        continue;
      }
      yield event;
    }
  }
}
