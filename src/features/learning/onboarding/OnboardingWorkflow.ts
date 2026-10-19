import type { OnboardingDraft, OnboardingStage } from "../../../domain/onboarding/types";
import type { ProgramConstraints } from "../../../domain/learning-program/types";

/** UI-independent onboarding state. Draft persistence is still an application port. */
export function restoreOnboardingDraft(initial?: OnboardingDraft): OnboardingDraft {
  const empty: OnboardingDraft = {
    version: 1, stage: "welcome", goal: "", interests: [],
    purpose: "career", level: "beginner", minutesPerSession: 45,
    sessionsPerWeek: 3, sourceBound: false,
  };
  if (!initial || initial.version !== 1) return empty;
  const stage: OnboardingStage = ["generating", "preview", "applying", "ready"].includes(initial.stage)
    ? "form" : initial.stage;
  return { ...initial, interests: [...initial.interests], stage };
}

export function withOnboardingStage(draft: OnboardingDraft, stage: OnboardingStage): OnboardingDraft {
  return { ...draft, stage };
}

/** Never reuse a prior source path when returning to general learning. */
export function withOnboardingSource(draft: OnboardingDraft, sourcePath?: string): OnboardingDraft {
  return { ...draft, sourceBound: Boolean(sourcePath), sourcePath };
}

export function onboardingConstraints(draft: OnboardingDraft): ProgramConstraints {
  return {
    minutesPerSession: draft.minutesPerSession, sessionsPerWeek: draft.sessionsPerWeek,
    startingLevel: draft.level,
    ...(draft.deadline ? { deadline: draft.deadline } : {}),
    sourceBound: draft.sourceBound,
    sourcePaths: draft.sourcePath ? [draft.sourcePath] : [], excludedTopics: [],
  };
}
