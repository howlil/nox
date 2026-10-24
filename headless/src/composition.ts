import {
  AgentRuntime, LearningController, SessionController, SessionStore,
  ContextResolver, type ContextSourcePort,
  type AgentAdapter, type AgentHealth, type AgentInput, type AgentModel,
  type AgentStreamEvent, type SendOptions,
} from "@nox/core";
import { FileWorkspace } from "./FileWorkspace";

/**
 * M2 second-host composition. This uses the production NOX orchestrator,
 * SessionController, evidence reconciliation and domain rules.
 * Provider inference is the only replaced dependency.
 */
export async function openHeadlessNox(directory: string, adapter: AgentAdapter) {
  const workspace = await FileWorkspace.open(directory);
  try {
    const session = new SessionController(workspace.sessionData, new SessionStore());
    await session.init();
    const runtime = new AgentRuntime(adapter);
    const source: ContextSourcePort = {
      getSelection: () => null,
      getCurrentNote: async () => null,
      loadNote: async () => null,
      searchNotes: () => [],
      searchKnowledge: async (query) => ({ query, subquestions: [query], hits: [], edges: [] }),
    };
    const context = new ContextResolver(source);
    const policies = { load: async () => ({ path: "headless/default", rawInstructions: "" }) };
    const mutations = { apply: async () => ({
      ok: false as const,
      reason: "no-editor" as const,
      message: "Headless host does not provide transactional editor/Undo; copy the proposal instead.",
    }) };
    const controller = new LearningController(session, runtime, context, policies,
      mutations, workspace.learningState, { turnTimeoutMs: 10_000 });
    return {
      controller,
      session,
      workspace,
      close: async () => { controller.dispose(); runtime.dispose(); await workspace.close(); },
    };
  } catch (error) {
    await workspace.close();
    throw error;
  }
}

/** Explicit demo-only test fixture. Never treated as a real model or credential. */
export class ScriptedProvider implements AgentAdapter {
  readonly sourceIsolation = "no-filesystem-tools" as const;
  readonly seen: Array<{ prompt: string; contextCount: number }> = [];
  private index = 0;

  constructor(private readonly responses: string[]) {}

  check(): Promise<AgentHealth> { return Promise.resolve({ status: "ready" }); }
  listModels(): Promise<AgentModel[]> { return Promise.resolve([{ id: "fixture", name: "Scripted Fixture (No AI)" }]); }

  async *send(input: AgentInput, _options: SendOptions, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    if (signal.aborted) { yield { type: "cancelled" }; return; }
    this.seen.push({ prompt: input.prompt, contextCount: input.context.length });
    const text = this.responses[this.index++];
    if (text === undefined) {
      yield { type: "failed", failure: { code: "runtime-unavailable", message: "No scripted response for this turn." } };
      return;
    }
    yield { type: "text", content: text };
    if (signal.aborted) { yield { type: "cancelled" }; return; }
    yield { type: "completed" };
  }
}
