/** User onboarding intent is not learning progress. */
export type OnboardingStage =
  | "welcome" | "discovery" | "suggestions" | "notes" | "form"
  | "generating" | "preview" | "applying" | "ready";
export interface OnboardingDraft {
  version: 1;
  stage: OnboardingStage;
  goal: string;
  interests: string[];
  purpose: "career" | "project" | "curiosity";
  level: "beginner" | "intermediate" | "advanced";
  minutesPerSession: number;
  sessionsPerWeek: number;
  sourceBound: boolean;
  sourcePath?: string;
  deadline?: string;
}
