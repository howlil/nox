import {
  AgentRuntime, LearningController, SessionController, SessionStore,
  ContextResolver, type ContextSourcePort, type AgentAdapter,
  type AgentHealth, type AgentInput, type AgentModel,
  type AgentStreamEvent, type SendOptions,
} from "@nox/core";
import { BrowserWorkspace } from "./BrowserWorkspace";

/** The only browser host capabilities: local conversation/practice.
 * No ambient note discovery or native editor/Undo is fabricated. */
export async function openBrowserNox(databaseName: string, adapter: AgentAdapter) {
  const workspace = await BrowserWorkspace.open(databaseName);
  try {
    const sessions = new SessionController(workspace.sessionData, new SessionStore());
    await sessions.init();
    const runtime = new AgentRuntime(adapter);
    const source: ContextSourcePort = {
      getSelection: () => null,
      getCurrentNote: async () => null,
      loadNote: async () => null,
      searchNotes: () => [],
      searchKnowledge: async query => ({ query, subquestions: [query], hits: [], edges: [] }),
    };
    const context = new ContextResolver(source);
    const policies = { load: async () => ({ path: "browser/default", rawInstructions: "" }) };
    const mutations = { apply: async () => ({
      ok: false as const, reason: "no-editor" as const,
      message: "The browser proof has no native editor or approved mutation capability.",
    }) };
    const controller = new LearningController(sessions, runtime, context,
      policies, mutations, workspace.learningState, { turnTimeoutMs: 10_000 });
    return {
      controller, workspace, sessions,
      capabilities: Object.freeze({ ambientNotes: false, editorMutation: false,
        nativeUndo: false, learningSessions: true, localEvidence: true }),
      close: () => { controller.dispose(); runtime.dispose(); workspace.close(); },
    };
  } catch (error) { workspace.close(); throw error; }
}

/** Fixed inference fixture only. Not a browser credential or AI provider. */
export class BrowserScriptedProvider implements AgentAdapter {
  readonly sourceIsolation = "no-filesystem-tools" as const;
  readonly contexts: number[] = [];
  private next = 0;
  constructor(private readonly responses: string[]) {}
  check(): Promise<AgentHealth> { return Promise.resolve({ status: "ready" }); }
  listModels(): Promise<AgentModel[]> {
    return Promise.resolve([{ id: "browser-fixture", name: "Scripted Fixture (No AI)" }]);
  }
  async *send(input: AgentInput, _options: SendOptions, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    if (signal.aborted) { yield { type: "cancelled" }; return; }
    this.contexts.push(input.context.length);
    const response = this.responses[this.next++];
    if (response === undefined) {
      yield { type: "failed", failure: { code: "runtime-unavailable",
        message: "No scripted response for browser turn" } };
      return;
    }
    yield { type: "text", content: response };
    yield { type: "completed" };
  }
}
