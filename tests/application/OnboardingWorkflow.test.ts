import assert from "node:assert/strict";
import test from "node:test";
import { onboardingConstraints, quickPlanCommand, restoreOnboardingDraft, withOnboardingSource, withOnboardingStage } from "../../src/features/learning/onboarding/OnboardingWorkflow";

test("R2 recovery discards ephemeral provider stages but retains user form details", () => {
  const base = restoreOnboardingDraft();
  for (const stage of ["generating", "preview", "applying", "ready"] as const) {
    const restored = restoreOnboardingDraft({ ...base, stage, goal: "REST APIs", interests: ["Technology"] });
    assert.equal(restored.stage, "form");
    assert.equal(restored.goal, "REST APIs");
    assert.notEqual(restored.interests, base.interests);
  }
  assert.equal(restoreOnboardingDraft({ ...base, stage: "discovery" }).stage, "welcome");
  assert.equal(restoreOnboardingDraft({ ...base, stage: "suggestions" }).stage, "welcome");
  assert.equal(restoreOnboardingDraft({ ...base, stage: "quick-goal", goal: "Learn SQL" }).stage, "quick-goal");
  assert.equal(restoreOnboardingDraft({ ...base, stage: "notes", sourcePath: "Book.md" }).stage, "notes");
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

test("M2 quick goal uses the existing no-workspace /plan command without stale note scope", () => {
  const fromNote = withOnboardingSource(restoreOnboardingDraft(), "private.md");
  const quick = withOnboardingStage(withOnboardingSource(fromNote), "quick-goal");
  assert.equal(quick.sourceBound, false);
  assert.deepEqual(onboardingConstraints(quick).sourcePaths, []);
  assert.equal(quickPlanCommand("  Learn   distributed\n systems  "), "/plan Learn distributed systems");
  assert.equal(quickPlanCommand("  Design REST APIs  "), "/plan Design REST APIs");
  assert.throws(() => quickPlanCommand("  "), /specific goal/);
  assert.throws(() => quickPlanCommand("abc"), /specific goal/);
});
