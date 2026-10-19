import assert from "node:assert/strict";
import test from "node:test";
import { onboardingConstraints, restoreOnboardingDraft, withOnboardingSource, withOnboardingStage } from "../../src/features/learning/onboarding/OnboardingWorkflow";

test("R2 recovery discards ephemeral provider stages but retains user form details", () => {
  const base = restoreOnboardingDraft();
  for (const stage of ["generating", "preview", "applying", "ready"] as const) {
    const restored = restoreOnboardingDraft({ ...base, stage, goal: "REST APIs", interests: ["Technology"] });
    assert.equal(restored.stage, "form");
    assert.equal(restored.goal, "REST APIs");
    assert.notEqual(restored.interests, base.interests);
  }
  assert.equal(restoreOnboardingDraft({ ...base, stage: "discovery" }).stage, "discovery");
});
test("R2 stage and source transitions are immutable and never keep stale note scope", () => {
  const base = restoreOnboardingDraft();
  const fromNote = withOnboardingSource(base, "Book.md");
  assert.deepEqual(onboardingConstraints(fromNote).sourcePaths, ["Book.md"]);
  const unbound = withOnboardingSource(fromNote);
  assert.equal(unbound.sourceBound, false);
  assert.deepEqual(onboardingConstraints(unbound).sourcePaths, []);
  const form = withOnboardingStage(fromNote, "form");
  assert.equal(form.stage, "form");
  assert.equal(fromNote.stage, "welcome");
  assert.equal(base.sourceBound, false);
});
test("R2 maps a guided user draft to the unchanged canonical program constraints", () => {
  const draft = { ...restoreOnboardingDraft(), minutesPerSession: 25, sessionsPerWeek: 4,
    deadline: "2027-01-01", level: "intermediate" as const };
  assert.deepEqual(onboardingConstraints(draft), {
    minutesPerSession: 25, sessionsPerWeek: 4, startingLevel: "intermediate",
    deadline: "2027-01-01", sourceBound: false, sourcePaths: [], excludedTopics: [],
  });
});
