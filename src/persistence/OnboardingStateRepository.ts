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
      ...(candidate.draft?.version === 1 && typeof candidate.draft.goal === "string" ?
        { draft: candidate.draft } : {}),
    };
  }
  async saveDraft(draft: OnboardingDraft): Promise<void> {
    await this.data.update(data => ({ ...data, [KEY]: {
      ...((data[KEY] ?? {}) as Stored), draft: structuredClone(draft),
    } }));
  }
  async dismiss(): Promise<void> {
    await this.data.update(data => ({ ...data, [KEY]: {
      dismissed: true,
    } }));
  }
}
