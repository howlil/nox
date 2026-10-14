import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { NoxSettings } from "./NoxSettings";

export interface NoxSettingsHost {
  getSettings(): NoxSettings;
  getUsageRecords(): Array<{ id: string; at: number; provider: string; model: string;
    inputTokens: number; outputTokens: number; cachedInputTokens?: number }>;
  updateSettings(next: Partial<NoxSettings>): Promise<void>;
  getChatGPTConnection(): { connected: boolean; sharing: boolean; email?: string; description: string;
    lastFailure?: { stage: string; code: string; message: string } };
  connectChatGPT(): Promise<void>;
  disconnectChatGPT(): Promise<void>;
  getBuildDiagnostics(): { revision: string; builtAt: string; transport: string;
    pluginDir: string; vaultDir: string };
}

export class NoxSettingsTab extends PluginSettingTab {
  private settingsTail: Promise<void> = Promise.resolve();
  private usageProvider = "all";
  private usageModel = "all";
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

    this.renderUsage(containerEl);

    const build = this.nox.getBuildDiagnostics();
    new Setting(containerEl)
      .setName("Loaded plugin build")
      .setDesc("Git: " + build.revision + " · Built: " + build.builtAt +
        " · Transport: " + build.transport +
        " · Vault: " + build.vaultDir +
        " · Plugin: " + build.pluginDir)
      .addButton((button) => button
        .setButtonText("Copy build diagnostic")
        .onClick(async () => {
          const report = "NOX loaded build: revision=" + build.revision +
            "; builtAt=" + build.builtAt + "; transport=" + build.transport +
            "; vault=" + build.vaultDir + "; plugin=" + build.pluginDir;
          try {
            await navigator.clipboard.writeText(report);
            new Notice("NOX build diagnostic copied.");
          } catch { new Notice("Could not copy NOX build diagnostic."); }
        }));

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

  /** Provider-reported tokens, not quota, credits, spend or ChatGPT plan balance. */
  private renderUsage(parent: HTMLElement): void {
    parent.createEl("h3", { text: "Token usage" });
    const records = this.nox.getUsageRecords();
    const filters = parent.createDiv({ cls: "nox-settings-usage-filters" });
    const providers = ["all", ...new Set(records.map(r => r.provider))];
    const models = ["all", ...new Set(records
      .filter(r => this.usageProvider === "all" || r.provider === this.usageProvider)
      .map(r => r.model))];
    if (!models.includes(this.usageModel)) this.usageModel = "all";
    const providerSelect = filters.createEl("select", { attr: { "aria-label": "Filter usage by provider" } });
    for (const value of providers) providerSelect.createEl("option", { attr: { value }, text: value === "all" ? "All providers" : value });
    providerSelect.value = this.usageProvider;
    providerSelect.addEventListener("change", () => {
      this.usageProvider = providerSelect.value; this.usageModel = "all"; this.display();
    });
    const modelSelect = filters.createEl("select", { attr: { "aria-label": "Filter usage by model" } });
    for (const value of models) modelSelect.createEl("option", { attr: { value }, text: value === "all" ? "All models" : value });
    modelSelect.value = this.usageModel;
    modelSelect.addEventListener("change", () => { this.usageModel = modelSelect.value; this.display(); });
    const selected = records.filter(r =>
      (this.usageProvider === "all" || r.provider === this.usageProvider) &&
      (this.usageModel === "all" || r.model === this.usageModel));
    const usage = summarizeUsage(selected);
    const summary = parent.createDiv({ cls: "nox-settings-usage-summary" });
    const values: Array<[string, number]> = [
      ["Recorded requests", usage.requests], ["Input tokens", usage.inputTokens],
      ["Output tokens", usage.outputTokens], ["Cached input", usage.cachedInputTokens],
    ];
    for (const [label, value] of values) {
      const row = summary.createDiv({ cls: "nox-inspector-row" });
      row.createSpan({ text: label });
      row.createSpan({ cls: "nox-inspector-count", text: value.toLocaleString() });
    }
    parent.createEl("p", { cls: "setting-item-description",
      text: records.length ? "Recorded provider usage only. Missing reports are not estimated; no plan quota or billing balance is available." :
        "No usage receipts yet. Providers without usage reporting cannot be measured here." });
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
