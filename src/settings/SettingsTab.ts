import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type { NoxSettings } from "./NoxSettings";
import { mountTokenUsageSection, type TokenUsageHost } from "./TokenUsageSection";
import { mountProviderUsageSection, type ProviderUsageHost } from "./ProviderUsageSection";

type NoxSettingsPage = "settings" | "usage" | "token";
const SETTING_PAGES: ReadonlyArray<{ value: NoxSettingsPage; label: string }> = [
  { value: "settings", label: "Settings" },
  { value: "usage", label: "Usage" },
  { value: "token", label: "Token" },
];

export interface NoxSettingsHost extends TokenUsageHost, ProviderUsageHost {
  getSettings(): NoxSettings;
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
  private activePage: NoxSettingsPage = "settings";
  private disposeSection?: () => void;
  constructor(app: App, private readonly nox: NoxSettingsHost & import("obsidian").Plugin) {
    super(app, nox);
  }

  display(): void {
    const { containerEl } = this;
    this.disposeSection?.();
    this.disposeSection = undefined;
    const settings = this.nox.getSettings();
    containerEl.empty();
    containerEl.addClass("nox-settings");
    new Setting(containerEl).setName("Nox").setHeading();

    const nav = containerEl.createDiv({ cls: "nox-settings-tabs", attr: {
      role: "tablist", "aria-label": "Nox settings sections",
    } });
    for (const page of SETTING_PAGES) {
      const tab = nav.createEl("button", {
        text: page.label,
        cls: "nox-settings-tab",
        attr: {
          type: "button", role: "tab",
          id: "nox-settings-tab-" + page.value,
          "aria-controls": "nox-settings-panel",
          "aria-selected": String(this.activePage === page.value),
          tabindex: this.activePage === page.value ? "0" : "-1",
        },
      });
      tab.toggleClass("is-active", this.activePage === page.value);
      tab.addEventListener("click", () => this.openPage(page.value));
      tab.addEventListener("keydown", (event: KeyboardEvent) => {
        const index = SETTING_PAGES.findIndex(p => p.value === page.value);
        const next = event.key === "ArrowRight" ? index + 1 :
          event.key === "ArrowLeft" ? index - 1 :
          event.key === "Home" ? 0 :
          event.key === "End" ? SETTING_PAGES.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        this.openPage(SETTING_PAGES[(next + SETTING_PAGES.length) % SETTING_PAGES.length].value, true);
      });
    }
    const pageContent = containerEl.createDiv({ cls: "nox-settings-page", attr: {
      id: "nox-settings-panel", role: "tabpanel",
      "aria-labelledby": "nox-settings-tab-" + this.activePage,
    } });
    if (this.activePage === "usage") {
      this.disposeSection = mountProviderUsageSection(pageContent, this.nox);
      return;
    }
    if (this.activePage === "token") {
      this.disposeSection = mountTokenUsageSection(pageContent, this.nox);
      return;
    }

    new Setting(pageContent)
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
      new Setting(pageContent)
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
        new Setting(pageContent)
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
      new Setting(pageContent)
        .setName("ChatGPT plan access")
        .setDesc("Requires plan permission. Selected note context is sent to OpenAI when you submit a message. This is not API-key billing.");
    } else new Setting(pageContent)
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

    const build = this.nox.getBuildDiagnostics();
    new Setting(pageContent)
      .setName("Loaded plugin build")
      .setDesc((build.revision.startsWith("release/")
        ? "Release: " + build.revision.slice(8) + " · Reproducible build"
        : "Git: " + build.revision + " · Built: " + build.builtAt) +
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

    new Setting(pageContent)
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

  private openPage(page: NoxSettingsPage, focus = false): void {
    if (this.activePage !== page) {
      this.activePage = page;
      this.display();
    }
    if (focus) {
      this.containerEl.querySelector<HTMLButtonElement>("#nox-settings-tab-" + page)?.focus();
    }
  }

  hide(): void {
    this.disposeSection?.();
    this.disposeSection = undefined;
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
