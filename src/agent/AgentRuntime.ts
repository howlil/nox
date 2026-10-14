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
  private discovery?: AbortController;

  constructor(private adapter: AgentAdapter) {}

  async replaceAdapter(adapter: AgentAdapter): Promise<void> {
    this.adapter = adapter;
    this.models = [];
    await this.init();
  }

  async init(): Promise<void> {
    this.discovery?.abort();
    const discovery = this.discovery = new AbortController();
    const adapter = this.adapter;
    try {
      const models = await adapter.listModels(discovery.signal);
      if (this.discovery === discovery && !discovery.signal.aborted) this.models = models;
    } catch {
      if (this.discovery === discovery && !discovery.signal.aborted) this.models = [];
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

  send(
    input: AgentInput,
    opts: SendOptions,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    return this.adapter.send(input, opts, signal);
  }
}
