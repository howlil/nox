import assert from "node:assert/strict";
import test from "node:test";
import { SessionController } from "../../src/session/SessionController";
import { SessionStore } from "../../src/session/SessionStore";
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

function createController(
  harness: ReturnType<typeof pluginHarness>,
  options: ConstructorParameters<typeof SessionStore>[0] = {
    now: () => 1,
    uuid: () => "session-1",
  },
) {
  return new SessionController(
    new PluginDataRepository(harness.plugin as never),
    new SessionStore(options),
  );
}

test("initializes a conversation without depending on runtime availability", async () => {
  const harness = pluginHarness();
  const controller = createController(harness);

  await controller.init();

  assert.equal(controller.getSession().id, "session-1");
});

test("conversation mutations persist display messages and conversation id", async () => {
  const harness = pluginHarness();
  const controller = createController(harness);

  await controller.init();
  await controller.recordUserMessage("what the user typed");
  await controller.setConversationId("conversation-1");
  await controller.recordAssistantMessage("answer", "note.md");

  assert.equal(
    controller.getSession().messages[0]?.content,
    "what the user typed",
  );
  assert.equal(
    controller.getSession().conversationId,
    "conversation-1",
  );
  assert.equal(
    controller.getSession().messages[1]?.sourcePath,
    "note.md",
  );
  assert.ok(harness.getData());
});

test("blank assistant messages are not persisted", async () => {
  const harness = pluginHarness();
  const controller = createController(harness);

  await controller.init();
  await controller.recordAssistantMessage("   ");

  assert.deepEqual(controller.getSession().messages, []);
});

test("lists sessions and restores a selected session as current", async () => {
  const harness = pluginHarness();
  let id = 0;
  let now = 0;

  const controller = createController(harness, {
    now: () => ++now,
    uuid: () => `session-${++id}`,
  });

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
