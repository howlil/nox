import test from "node:test";
import assert from "node:assert/strict";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";
import { OnboardingStateRepository } from "../../src/persistence/OnboardingStateRepository";
import type { OnboardingDraft } from "../../packages/core/src/domain/onboarding/types";

test("onboarding draft persists via serialized plugin data and skip removes draft", async () => {
  let current: Record<string, unknown> = { "nox-settings": { provider: "agy" } };
  const plugin = { loadData: async () => structuredClone(current),
    saveData: async (next: Record<string, unknown>) => { current = structuredClone(next); } };
  const state = new OnboardingStateRepository(new PluginDataRepository(plugin as never));
  const draft: OnboardingDraft = { version: 1, stage: "form", goal: "Learn SQL",
    interests: ["Technology"], purpose: "career", level: "beginner",
    minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false };
  await state.saveDraft(draft);
  assert.deepEqual((await state.load()).draft, draft);
  await state.dismiss();
  assert.equal((await state.load()).dismissed, true);
  assert.equal((await state.load()).draft, undefined);
  assert.deepEqual(current["nox-settings"], { provider: "agy" });
  await state.reopen();
  assert.equal((await state.load()).dismissed, false);
  assert.equal((await state.load()).draft, undefined);
});

test("M4 receipt is durably stored before interruption and survives an app reload", async () => {
  let data: Record<string, unknown> = {};
  const plugin = {
    loadData: async () => structuredClone(data),
    saveData: async (next: Record<string, unknown>) => { data = structuredClone(next); },
  };
  const first = new OnboardingStateRepository(new PluginDataRepository(plugin as never));
  const receipt = {
    programId: "11111111-1111-4111-8111-111111111111",
    operationId: "22222222-2222-4222-8222-222222222222",
    withWorkspace: true,
  };
  const draft: OnboardingDraft = { version: 1, stage: "applying",
    goal: "Learn fault tolerance", interests: [], purpose: "career",
    level: "beginner", minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false, approval: receipt };
  await first.saveDraft(draft);
  const restarted = new OnboardingStateRepository(new PluginDataRepository(plugin as never));
  assert.deepEqual((await restarted.load()).draft?.approval, receipt);
  assert.equal((await restarted.load()).draft?.stage, "applying");
  await restarted.saveDraft({ ...draft, stage: "ready" });
  assert.equal((await restarted.load()).draft?.stage, "ready");
  await restarted.dismiss();
  assert.equal((await restarted.load()).draft, undefined);
});

test("M4 malformed approval receipt cannot enter recovery or authorize workspace writes", async () => {
  const draft: OnboardingDraft = { version: 1, stage: "applying",
    goal: "Learn fault tolerance", interests: [], purpose: "career",
    level: "beginner", minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false };
  let current: Record<string, unknown> = { "nox-onboarding": {
    dismissed: false, draft: { ...draft, approval: {
      programId: "../../outside.md", operationId: "not-a-uuid", withWorkspace: "yes",
    } },
  } };
  const plugin = { loadData: async () => structuredClone(current),
    saveData: async (next: Record<string, unknown>) => { current = structuredClone(next); } };
  const store = new OnboardingStateRepository(new PluginDataRepository(plugin as never));
  assert.equal((await store.load()).draft?.approval, undefined);
});
