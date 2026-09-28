import {
  AgentAdapter,
  AgentHealth,
  AgentInput,
  AgentModel,
  AgentStreamEvent,
  SendOptions,
} from "../types";

export interface AgentRuntimePort {
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

  constructor(private readonly adapter: AgentAdapter) {}

  async init(): Promise<void> {
    try {
      this.models = await this.adapter.listModels();
    } catch {
      this.models = [];
    }
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
