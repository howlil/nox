import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "../../../src/agent/AgentRuntime";
import { LearningController } from "../../../src/application/LearningController";
import { SessionController } from "../../../src/session/SessionController";
import { SessionStore } from "../../../src/session/SessionStore";
import { PluginDataRepository } from "../../../src/persistence/PluginDataRepository";
import { DEFAULT_NOX_SETTINGS, decodeNoxSettings, NOX_SETTINGS_KEY } from "../../../src/settings/NoxSettings";
import { modelMenuItems } from "../../../src/chat/model-menu";
import type { AgentAdapter, SendOptions } from "../../../src/types";
import { collectEvents } from "../../support/collect-events";

async function rig() {
  let data: Record<string, unknown> = { unrelated: "keep", [NOX_SETTINGS_KEY]: DEFAULT_NOX_SETTINGS };
  let save: () => Promise<void> = async () => {};
  const repository = new PluginDataRepository({
    loadData: async () => structuredClone(data),
    saveData: async (next: Record<string, unknown>) => { await save(); data = structuredClone(next); },
  } as never);
  const sessions = new SessionController(repository, new SessionStore());
  await sessions.init();
  await sessions.configureRuntime("agy");
  await sessions.setModel("agy-model");
  await sessions.setConversationId("agy-thread");
  await sessions.recordAssistantMessage("Existing answer");
  const calls: Array<{ provider: string; options: SendOptions }> = [];
  const adapter = (provider: string): AgentAdapter => ({
    listModels: async () => provider === "agy" ? [{ id: "agy-model", name: "AGY model" }] : [],
    check: async () => ({ status: "ready" }),
    send: async function* (_input, options) {
      calls.push({ provider, options });
      yield { type: "text", content: provider + " answer" };
      yield { type: "completed", conversationId: provider + "-thread" };
    },
  });
  const runtime = new AgentRuntime(adapter("agy"));
  await runtime.init();
  const controller = new LearningController(sessions, runtime, {
    resolve: async () => ({ explicit: [] }), searchNotes: () => [], toAgentContext: () => [],
  }, { load: async () => ({ path: "AGENTS.md", rawInstructions: "" }) }, {
    apply: async () => ({ ok: true }),
  }, { load: async () => ({ version: 2, target: null, gaps: [], evidence: [] }), save: async () => {} });
  const change = (provider: "agy" | "codex", preferredModel = "", replace = true) => controller.configureRuntime(
    provider, replace ? adapter(provider) : undefined, preferredModel || undefined, {
      updateModel: true,
      updateData: (current) => ({ ...current, [NOX_SETTINGS_KEY]: { ...DEFAULT_NOX_SETTINGS, provider, preferredModel } }),
    },
  );
  return { sessions, runtime, controller, change, calls, adapter, repository,
    data: () => structuredClone(data), saveWith: (operation: typeof save) => { save = operation; },
    send: () => collectEvents(controller.run({ prompt: "hello", action: "ask", explicitContext: [], turnId: crypto.randomUUID() })),
  };
}

test("switching provider refreshes model choices and next turn without restarting or losing history", async () => {
  const r = await rig();
  const previous = r.sessions.getSession();
  await r.change("codex");
  assert.deepEqual(modelMenuItems(r.controller.getModels(), r.sessions.getSession().model), [{ id: "", name: "Runtime default" }]);
  assert.equal(r.sessions.getSession().conversationId, undefined);
  assert.deepEqual(r.sessions.getSession().messages, previous.messages);
  assert.equal(decodeNoxSettings(r.data()).provider, "codex");
  assert.equal(r.data().unrelated, "keep");
  assert.equal((await r.send()).at(-1)?.type, "completed");
  assert.equal(r.calls[0].provider, "codex");
  assert.equal(r.calls[0].options.conversationId, undefined);
  assert.equal(r.calls[0].options.model, undefined);
  await r.change("codex", "custom-codex-model", false);
  assert.equal(modelMenuItems(r.controller.getModels(), r.sessions.getSession().model).at(-1)?.name, "custom-codex-model");
  await r.send();
  assert.equal(r.calls[1].options.model, "custom-codex-model");
  await r.change("agy");
  assert.equal(r.sessions.getSession().conversationId, undefined);
  assert.deepEqual(r.controller.getModels(), [{ id: "agy-model", name: "AGY model" }]);
  await r.send();
  assert.equal(r.calls.at(-1)?.provider, "agy");
});

test("failed settings write keeps provider, model, cursor and catalog unchanged in memory and on disk", async () => {
  const r = await rig();
  const previous = r.sessions.getSession();
  const disk = r.data();
  r.saveWith(async () => { throw new Error("disk unavailable"); });
  await assert.rejects(r.change("codex"), /persist runtime selection/);
  assert.deepEqual(r.sessions.getSession(), previous);
  assert.deepEqual(r.data(), disk);
  assert.deepEqual(r.controller.getModels(), [{ id: "agy-model", name: "AGY model" }]);
  r.saveWith(async () => {});
  await r.send();
  assert.equal(r.calls[0].provider, "agy");
  assert.equal(r.calls[0].options.conversationId, "agy-thread");
});

test("settings commit blocks competing turns, sessions, models, edits and provider changes", async () => {
  const r = await rig();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  r.saveWith(() => waiting);
  const pending = r.change("codex");
  assert.equal((await r.send()).at(-1)?.type, "failed");
  await assert.rejects(r.controller.newSession(), /settings/);
  await assert.rejects(r.controller.selectSession(r.sessions.getSession().id), /settings/);
  assert.throws(() => r.controller.setModel("other"), /settings/);
  assert.equal((await r.controller.applyProposal("proposal")).ok, false);
  await assert.rejects(r.change("agy"), /settings/);
  release();
  await pending;
  await r.send();
  assert.equal(r.calls[0].provider, "codex");
});

test("provider change is rejected while an existing turn is active", async () => {
  const r = await rig();
  const iterator = r.controller.run({ prompt: "hello", action: "ask", explicitContext: [], turnId: crypto.randomUUID() })[Symbol.asyncIterator]();
  await iterator.next();
  await assert.rejects(r.change("codex"), /active turn/);
  assert.equal(decodeNoxSettings(r.data()).provider, "agy");
  while (!(await iterator.next()).done) { /* Drain the original turn. */ }
  assert.equal(r.calls[0].provider, "agy");
});
