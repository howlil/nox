import { App, PluginSettingTab, Setting } from "obsidian";
import type { NoxSettings } from "./NoxSettings";

export interface NoxSettingsHost {
  getSettings(): NoxSettings;
  updateSettings(next: Partial<NoxSettings>): Promise<void>;
}

export class NoxSettingsTab extends PluginSettingTab {
  constructor(app: App, private readonly nox: NoxSettingsHost & import("obsidian").Plugin) {
    super(app, nox);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.nox.getSettings();
    containerEl.empty();
    containerEl.createEl("h2", { text: "Nox" });

    new Setting(containerEl)
      .setName("Agent executable")
      .setDesc("Optional absolute path to the configured agent runtime.")
      .addText((text) =>
        text
          .setPlaceholder("Use PATH discovery")
          .setValue(settings.executablePath)
          .onChange(async (value) => {
            await this.nox.updateSettings({ executablePath: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName("Preferred model")
      .setDesc("Leave blank to use the runtime default model.")
      .addText((text) =>
        text
          .setPlaceholder("Runtime default")
          .setValue(settings.preferredModel)
          .onChange(async (value) => {
            await this.nox.updateSettings({ preferredModel: value.trim() });
          }),
      );
  }
}
