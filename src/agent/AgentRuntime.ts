import {
  AgentAdapter,
  AgentHealth,
  AgentInput,
  AgentModel,
  AgentStreamEvent,
  SendOptions,
} from "../types";

export interface AgentRuntimePort {
  replaceAdapter?(adapter: AgentAdapter): Promise<void>;
  check(): Promise<AgentHealth>;
  getModels(): AgentModel[];
  getModelDiscoveryError?(): string | undefined;
  refreshModels?(): Promise<void>;
  send(
    input: AgentInput,
    opts: SendOptions,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent>;
}

/**
 * Owns runtime lifecycle and runtime-derived state.
 *
 * Conversation/session history is intentionally not represented here.
 */
export class AgentRuntime implements AgentRuntimePort {
  private models: AgentModel[] = [];
  private modelDiscoveryError?: string;
  private discovery?: AbortController;

  constructor(private adapter: AgentAdapter) {}

  async replaceAdapter(adapter: AgentAdapter): Promise<void> {
    this.adapter = adapter;
    this.models = [];
    this.modelDiscoveryError = undefined;
    await this.init();
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

  getModelDiscoveryError(): string | undefined { return this.modelDiscoveryError; }

  refreshModels(): Promise<void> { return this.init(); }

  send(
    input: AgentInput,
    opts: SendOptions,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    return this.adapter.send(input, opts, signal);
  }
}
