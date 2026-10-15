import { App, Modal, Notice, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import type { NoxSettings } from "./NoxSettings";
import { mountTokenUsageSection, type TokenUsageHost } from "./TokenUsageSection";
import { mountProviderUsageSection, type ProviderUsageHost } from "./ProviderUsageSection";

export interface NoxSettingsHost extends TokenUsageHost, ProviderUsageHost {
  getSettings(): NoxSettings;
  updateSettings(next: Partial<NoxSettings>): Promise<void>;
  getChatGPTConnection(): {
    connected: boolean; sharing: boolean; email?: string; description: string;
    lastFailure?: { stage: string; code: string; message: string };
    storageRecoveryNeeded?: boolean;
  };
  connectChatGPT(): Promise<void>;
  disconnectChatGPT(): Promise<void>;
  recoverChatGPTStorage(): void;
  getBuildDiagnostics(): {
    revision: string; builtAt: string; transport: string;
    pluginDir: string; vaultDir: string;
  };
}

/**
 * Declarative Obsidian 1.13+ settings. All mutable controls use the existing
 * Nox settings host so runtime reconfiguration and persistence stay atomic.
 * getSettingDefinitions must be cheap: runtime reads/mounts belong in render.
 */
export class NoxSettingsTab extends PluginSettingTab {
  private settingsTail: Promise<void> = Promise.resolve();

  constructor(app: App, private readonly nox: NoxSettingsHost & import("obsidian").Plugin) {
    super(app, nox);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Agent provider",
        desc: "Choose an installed agent runtime or connect an eligible ChatGPT plan.",
        render: setting => {
          setting.addDropdown(dropdown => dropdown
            .addOption("agy", "AGY")
            .addOption("codex", "Codex")
            .addOption("chatgpt", "ChatGPT plan")
            .setValue(this.nox.getSettings().provider)
            .onChange(async value => {
              await this.saveSettings({
                provider: value === "codex" || value === "chatgpt" ? value : "agy",
                preferredModel: "",
              });
              this.update();
            }));
        },
      },
      {
        name: "ChatGPT account",
        desc: "Connect or refresh the ChatGPT plan authorization.",
        visible: () => this.nox.getSettings().provider === "chatgpt",
        render: setting => {
          const connection = this.nox.getChatGPTConnection();
          setting.setDesc(connection.email
            ? connection.email + " — " + connection.description : connection.description);
          setting.addButton(button => button
            .setButtonText(connection.connected ? "Reconnect ChatGPT" : "Continue with ChatGPT")
            .setCta()
            .setDisabled(Boolean(connection.storageRecoveryNeeded))
            .onClick(async () => {
              button.setDisabled(true);
              button.setButtonText("Waiting for ChatGPT...");
              try {
                await this.nox.connectChatGPT();
                const status = this.nox.getChatGPTConnection();
                new Notice(status.sharing
                  ? "ChatGPT connected. You can now use Nox."
                  : "ChatGPT signed in, but plan permission is not enabled.");
              } catch (error) {
                new Notice(error instanceof Error ? error.message : "ChatGPT sign-in failed.");
              } finally {
                this.update();
              }
            }));
          setting.addExtraButton(button => button
            .setIcon("log-out")
            .setTooltip("Disconnect ChatGPT")
            .setDisabled(!connection.connected)
            .onClick(async () => {
              try { await this.nox.disconnectChatGPT(); }
              catch (error) {
                new Notice(error instanceof Error ? error.message : "Unable to disconnect.");
              } finally { this.update(); }
            }));
        },
      },
      {
        name: "ChatGPT credential recovery",
        desc: "The local credential file cannot be read. Reset only after confirming; NOX keeps an encrypted or owner-only backup.",
        visible: () => this.nox.getSettings().provider === "chatgpt" &&
          Boolean(this.nox.getChatGPTConnection().storageRecoveryNeeded),
        render: setting => {
          setting.addButton(button => button
            .setButtonText("Back up and reset credentials")
            .onClick(() => {
              const modal = new Modal(this.app);
              modal.setTitle("Reset unreadable ChatGPT credentials?");
              modal.contentEl.createEl("p", { text:
                "NOX will preserve the unreadable file as a local recovery backup, disconnect ChatGPT, and allow a new sign-in. Other providers and notes are unchanged.",
              });
              const confirm = modal.contentEl.createEl("button", { text: "Back up and reset" });
              confirm.addEventListener("click", () => {
                try {
                  this.nox.recoverChatGPTStorage();
                  new Notice("Credential backup created. You can sign in again.");
                  modal.close();
                  this.update();
                } catch {
                  new Notice("Could not safely back up the credentials. The original file is unchanged.");
                }
              });
              modal.open();
            }));
        },
      },
      {
        name: "Last ChatGPT sign-in error",
        desc: "Copy a diagnostic without exposing credentials.",
        visible: () => this.nox.getSettings().provider === "chatgpt" &&
          Boolean(this.nox.getChatGPTConnection().lastFailure),
        render: setting => {
          const failure = this.nox.getChatGPTConnection().lastFailure;
          if (!failure) return;
          setting.setDesc(failure.message);
          setting.addButton(button => button.setButtonText("Copy diagnostic").onClick(async () => {
            const diagnostic = "NOX ChatGPT sign-in failure: stage=" +
              failure.stage + ", code=" + failure.code;
            try {
              await navigator.clipboard.writeText(diagnostic);
              new Notice("Safe diagnostic copied.");
            } catch { new Notice("Unable to copy diagnostic."); }
          }));
        },
      },
      {
        name: "ChatGPT plan access",
        desc: "Selected note context is sent to OpenAI on submit. This does not use API-key billing.",
        visible: () => this.nox.getSettings().provider === "chatgpt",
      },
      {
        name: "Agent executable",
        desc: "Optional absolute path to the configured CLI; leave blank for PATH discovery.",
        visible: () => this.nox.getSettings().provider !== "chatgpt",
        render: setting => {
          const config = this.nox.getSettings();
          setting.addText(text => text
            .setPlaceholder("Use PATH discovery")
            .setValue(config.provider === "codex" ? config.codexExecutablePath : config.executablePath)
            .onChange(async value => {
              await this.saveSettings(config.provider === "codex"
                ? { codexExecutablePath: value.trim() }
                : { executablePath: value.trim() });
            }));
        },
      },
      {
        name: "Preferred model",
        desc: "Leave blank to use the runtime default model.",
        render: setting => {
          setting.addText(text => text
            .setPlaceholder("Runtime default")
            .setValue(this.nox.getSettings().preferredModel)
            .onChange(async value => this.saveSettings({ preferredModel: value.trim() })));
        },
      },
      {
        type: "group",
        heading: "Diagnostics",
        items: [{
          name: "Loaded plugin build",
          desc: "Information to identify the installed runtime for support.",
          render: setting => {
            const build = this.nox.getBuildDiagnostics();
            setting.setDesc((build.revision.startsWith("release/")
              ? "Release: " + build.revision.slice(8) + " · Reproducible build"
              : "Git: " + build.revision + " · Built: " + build.builtAt) +
              " · Transport: " + build.transport +
              " · Vault: " + build.vaultDir + " · Plugin: " + build.pluginDir);
            setting.addButton(button => button
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
          },
        }],
      },
      {
        type: "page",
        name: "Usage",
        desc: "Provider usage and account limits.",
        items: [{
          name: "Provider usage",
          render: setting => mountProviderUsageSection(setting.controlEl, this.nox),
        }],
      },
      {
        type: "page",
        name: "Token",
        desc: "Local token consumption across models.",
        items: [{
          name: "Token usage",
          render: setting => mountTokenUsageSection(setting.controlEl, this.nox),
        }],
      },
    ];
  }

  private async saveSettings(update: Partial<NoxSettings>): Promise<void> {
    const operation = this.settingsTail.then(async () => {
      try { await this.nox.updateSettings(update); }
      catch (error) {
        new Notice(error instanceof Error ? error.message : "Unable to save runtime settings.");
        this.update();
      }
    });
    this.settingsTail = operation;
    await operation;
  }
}
