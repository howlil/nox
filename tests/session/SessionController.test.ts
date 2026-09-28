import assert from "node:assert/strict";
import test from "node:test";
import { SessionController } from "../../src/session/SessionController";
import { SessionStore } from "../../src/session/SessionStore";
import { AgentAdapter } from "../../src/types";
import { collectEvents } from "../support/collect-events";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";

function pluginHarness(initial: Record<string, unknown> | null = null) {
  let data = initial;
  return {
    plugin: {
      loadData: async () => data,
      saveData: async (next: Record<string, unknown>) => {
        data = next;
      },
    },
    getData: () => data,
  };
}

test("initializes even when model discovery fails", async () => {
  const harness = pluginHarness();
  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => {
      throw new Error("models unavailable");
    },
    send: async function* () {
      yield { type: "completed" };
    },
  };

  const controller = new SessionController(
    new PluginDataRepository(harness.plugin as never),
    new SessionStore({
      now: () => 1,
      uuid: () => "session-1",
    }),
    adapter,
  );

  await controller.init();

  assert.equal(controller.getSession().id, "session-1");
  assert.deepEqual(controller.getModels(), []);
});

test("sendTurn stores only the display prompt and persists conversation id", async () => {
  const harness = pluginHarness();
  let sentPrompt = "";
  let sentContextCount = 0;

  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => [],
    send: async function* (input) {
      sentPrompt = input.prompt;
      sentContextCount = input.context.length;
      yield { type: "text", content: "answer" };
      yield {
        type: "completed",
        conversationId: "conversation-1",
      };
    },
  };

  const controller = new SessionController(
    new PluginDataRepository(harness.plugin as never),
    new SessionStore({
      now: () => 1,
      uuid: () => "session-1",
    }),
    adapter,
  );

  await controller.init();

  const events = await collectEvents(
    controller.sendTurn(
      "internal learning instruction",
      [
        {
          type: "note",
          file: "note.md",
          content: "context",
        },
      ],
      "what the user typed",
      new AbortController().signal,
    ),
  );

  assert.equal(sentPrompt, "internal learning instruction");
  assert.equal(sentContextCount, 1);
  assert.equal(events.at(-1)?.type, "completed");
  assert.equal(
    controller.getSession().messages[0]?.content,
    "what the user typed",
  );
  assert.equal(
    controller.getSession().messages[0]?.content.includes("internal"),
    false,
  );
  assert.equal(
    controller.getSession().conversationId,
    "conversation-1",
  );
  await controller.recordAssistantMessage("answer", "note.md");
  assert.equal(controller.getSession().messages[1]?.sourcePath, "note.md");
  assert.ok(harness.getData());
});

test("blank assistant messages are not persisted", async () => {
  const harness = pluginHarness();
  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => [],
    send: async function* () {
      yield { type: "completed" };
    },
  };

  const controller = new SessionController(
    new PluginDataRepository(harness.plugin as never),
    new SessionStore({
      now: () => 1,
      uuid: () => "session-1",
    }),
    adapter,
  );

  await controller.init();
  await controller.recordAssistantMessage("   ");

  assert.deepEqual(controller.getSession().messages, []);
});

test("lists sessions and restores a selected session as current", async () => {
  const harness = pluginHarness();
  const adapter: AgentAdapter = {
    check: async () => ({ status: "ready" }),
    listModels: async () => [],
    send: async function* () {
      yield { type: "completed" };
    },
  };
  let id = 0;
  let now = 0;

  const controller = new SessionController(
    new PluginDataRepository(harness.plugin as never),
    new SessionStore({
      now: () => ++now,
      uuid: () => `session-${++id}`,
    }),
    adapter,
  );

  await controller.init();
  const first = controller.getSession();
  const second = await controller.newSession();

  assert.deepEqual(
    controller.listSessions().map((session) => session.id),
    [second.id, first.id],
  );

  const selected = await controller.selectSession(first.id);
  assert.equal(selected?.id, first.id);
  assert.equal(controller.getSession().id, first.id);
  assert.equal(
    (harness.getData() as { "nox-sessions"?: { currentSessionId?: string } })[
      "nox-sessions"
    ]?.currentSessionId,
    first.id,
  );
});
