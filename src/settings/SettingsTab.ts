import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { NoxSettings } from "./NoxSettings";

export interface NoxSettingsHost {
  getSettings(): NoxSettings;
  updateSettings(next: Partial<NoxSettings>): Promise<void>;
  getChatGPTConnection(): { connected: boolean; sharing: boolean; email?: string; description: string;
    lastFailure?: { stage: string; code: string; message: string } };
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
      .setDesc("Choose AGY or Codex CLI, or sign in directly with your ChatGPT plan.")
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
            button.setButtonText("Waiting for ChatGPT...");
            try {
              await this.nox.connectChatGPT();
              const status = this.nox.getChatGPTConnection();
              new Notice(status.sharing
                ? "ChatGPT connected. You can now use Nox."
                : "ChatGPT signed in, but plan permission is not enabled.");
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "ChatGPT sign-in failed.");
              this.display(); // Restore the connect button on any failed attempt.
            }
          }))
        .addExtraButton((button) => button
          .setIcon("log-out")
          .setTooltip("Disconnect ChatGPT")
          .setDisabled(!connection.connected)
          .onClick(async () => {
            try { await this.nox.disconnectChatGPT(); this.display(); }
            catch (error) { new Notice(error instanceof Error ? error.message : "Unable to disconnect."); }
          }));
      if (connection.lastFailure) {
        new Setting(containerEl)
          .setName("Last ChatGPT sign-in error")
          .setDesc(connection.lastFailure.message)
          .addButton((button) => button
            .setButtonText("Copy diagnostic")
            .onClick(() => {
              const report = "NOX ChatGPT sign-in failure: stage=" +
                connection.lastFailure!.stage + ", code=" + connection.lastFailure!.code;
              void navigator.clipboard.writeText(report).then(
                () => new Notice("Safe diagnostic copied."),
                () => new Notice("Unable to copy diagnostic."),
              );
            }));
      }
      new Setting(containerEl)
        .setName("Plan usage")
        .setDesc("Requires ChatGPT plan permission. Selected note context is sent to OpenAI when you submit a message. Uses the official Responses API, not your API billing key.");
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
