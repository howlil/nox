import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { NoxSettings } from "./NoxSettings";
import type { ChatGptConnection } from "../agent/ChatGptAuth";

export interface NoxSettingsHost {
  getSettings(): NoxSettings;
  updateSettings(next: Partial<NoxSettings>): Promise<void>;
  getChatGPTConnection(): ChatGptConnection;
  connectChatGPT(): Promise<void>;
  disconnectChatGPT(): Promise<void>;
}

export class NoxSettingsTab extends PluginSettingTab {
  private settingsTail: Promise<void> = Promise.resolve();
  constructor(app: App, private readonly nox: NoxSettingsHost & import("obsidian").Plugin) {
    super(app, nox);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.nox.getSettings();
    containerEl.empty();
    containerEl.createEl("h2", { text: "Nox" });

    new Setting(containerEl)
      .setName("Agent provider")
      .setDesc("Choose the local CLI. Changes apply immediately while idle. Codex uses its existing local sign-in.")
      .addDropdown((dropdown) => dropdown
        .addOption("agy", "AGY")
        .addOption("codex", "Codex")
        .addOption("chatgpt", "ChatGPT plan")
        .setValue(settings.provider)
        .onChange(async (value) => {
          await this.saveSettings({ provider: value === "codex" || value === "chatgpt" ? value : "agy", preferredModel: "" });
          this.display();
        }));

    if (settings.provider === "chatgpt") {
      const connection = this.nox.getChatGPTConnection();
      new Setting(containerEl)
        .setName("ChatGPT account")
        .setDesc(connection.email ? connection.email + " — " + connection.description : connection.description)
        .addButton((button) => button
          .setButtonText(connection.connected ? "Reconnect ChatGPT" : "Continue with ChatGPT")
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            try { await this.nox.connectChatGPT(); this.display(); }
            catch (error) { new Notice(error instanceof Error ? error.message : "ChatGPT sign-in failed."); button.setDisabled(false); }
          }))
        .addExtraButton((button) => button
          .setIcon("log-out")
          .setTooltip("Disconnect ChatGPT")
          .setDisabled(!connection.connected)
          .onClick(async () => {
            try { await this.nox.disconnectChatGPT(); this.display(); }
            catch (error) { new Notice(error instanceof Error ? error.message : "Unable to disconnect."); }
          }));
      new Setting(containerEl)
        .setName("Plan usage")
        .setDesc("Requires ChatGPT plan permission. Requests use the official Responses API, not your API billing key.");
    } else new Setting(containerEl)
      .setName("Agent executable")
      .setDesc("Optional absolute path to the configured agent runtime.")
      .addText((text) =>
        text
          .setPlaceholder("Use PATH discovery")
          .setValue(settings.provider === "codex" ? settings.codexExecutablePath : settings.executablePath)
          .onChange(async (value) => {
            await this.saveSettings(settings.provider === "codex"
              ? { codexExecutablePath: value.trim() } : { executablePath: value.trim() });
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
            await this.saveSettings({ preferredModel: value.trim() });
          }),
      );
  }

  private async saveSettings(update: Partial<NoxSettings>): Promise<void> {
    const operation = this.settingsTail.then(async () => {
      try {
        await this.nox.updateSettings(update);
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Unable to save runtime settings.");
        this.display();
      }
    });
    this.settingsTail = operation;
    await operation;
  }
}
