import test from "node:test";
import assert from "node:assert/strict";
import { PluginDataRepository } from "../../src/persistence/PluginDataRepository";
import { OnboardingStateRepository } from "../../src/persistence/OnboardingStateRepository";
import type { OnboardingDraft } from "../../src/domain/onboarding/types";

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
