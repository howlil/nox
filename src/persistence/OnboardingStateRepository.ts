import type { OnboardingDraft } from "../domain/onboarding/types";
import type { PluginDataRepository } from "./PluginDataRepository";

const KEY = "nox-onboarding";
type Stored = { dismissed?: boolean; draft?: OnboardingDraft };
export class OnboardingStateRepository {
  constructor(private readonly data: PluginDataRepository) {}
  async load(): Promise<Stored> {
    const value = (await this.data.read())[KEY];
    if (!value || typeof value !== "object") return {};
    const candidate = value as Stored;
    return {
      dismissed: candidate.dismissed === true,
      ...(candidate.draft?.version === 1 && typeof candidate.draft.goal === "string" &&
        candidate.draft.goal.length <= 1000 &&
        Array.isArray(candidate.draft.interests) &&
        candidate.draft.interests.every(item => typeof item === "string" && item.length <= 80) &&
        ["career", "project", "curiosity"].includes(candidate.draft.purpose) &&
        ["beginner", "intermediate", "advanced"].includes(candidate.draft.level) &&
        Number.isInteger(candidate.draft.minutesPerSession) &&
        candidate.draft.minutesPerSession >= 10 && candidate.draft.minutesPerSession <= 240 &&
        Number.isInteger(candidate.draft.sessionsPerWeek) &&
        candidate.draft.sessionsPerWeek >= 1 && candidate.draft.sessionsPerWeek <= 7 ?
        { draft: candidate.draft } : {}),
    };
  }
  async saveDraft(draft: OnboardingDraft): Promise<void> {
    await this.data.update(data => ({ ...data, [KEY]: {
      ...((data[KEY] ?? {}) as Stored), draft: structuredClone(draft),
    } }));
  }
  async reopen(): Promise<void> {
    await this.data.update(data => ({ ...data, [KEY]: { dismissed: false } }));
  }
  async dismiss(): Promise<void> {
    await this.data.update(data => ({ ...data, [KEY]: {
      dismissed: true,
    } }));
  }
}
