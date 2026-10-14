/** Minimum serialized plugin-data writer needed by settings. */
export interface SettingsDataPort {
  update(update: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}

export const NOX_SETTINGS_KEY = "nox-settings";

export interface NoxSettings {
  provider: "agy" | "codex";
  executablePath: string;
  codexExecutablePath: string;
  preferredModel: string;
}

export const DEFAULT_NOX_SETTINGS: NoxSettings = {
  provider: "agy",
  executablePath: "",
  codexExecutablePath: "",
  preferredModel: "",
};

export function decodeNoxSettings(
  rawData: Record<string, unknown> | null,
): NoxSettings {
  const value = rawData?.[NOX_SETTINGS_KEY];
  if (!value || typeof value !== "object") return { ...DEFAULT_NOX_SETTINGS };
  const candidate = value as Partial<NoxSettings>;
  return {
    provider: candidate.provider === "codex" ? "codex" : "agy",
    codexExecutablePath: typeof candidate.codexExecutablePath === "string" ? candidate.codexExecutablePath : "",
    executablePath:
      typeof candidate.executablePath === "string"
        ? candidate.executablePath
        : "",
    preferredModel:
      typeof candidate.preferredModel === "string"
        ? candidate.preferredModel
        : "",
  };
}

export async function saveNoxSettings(
  pluginData: SettingsDataPort,
  settings: NoxSettings,
): Promise<void> {
  await pluginData.update((current) => ({
    ...current,
    [NOX_SETTINGS_KEY]: settings,
  }));
}
