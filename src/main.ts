import { addIcon, FileSystemAdapter, Plugin } from "obsidian";
import { AgyAdapter } from "./agent/AgyAdapter";
import { CodexAdapter } from "./agent/CodexAdapter";
import { ChatGptAdapter } from "./agent/ChatGptAdapter";
import { ChatGptAuth, type ChatGptConnection } from "./agent/ChatGptAuth";
import { AgentRuntime } from "./agent/AgentRuntime";
import { ChatView, NOX_VIEW_TYPE } from "./chat/ChatView";
import { ContextResolver } from "./context/ContextResolver";
import { ObsidianContext } from "./context/ObsidianContext";
import { PolicyLoader } from "./context/PolicyLoader";
import { LearningController } from "./application/LearningController";
import { MutationService } from "./mutation/MutationService";
import { VaultLearningStore } from "./persistence/VaultLearningStore";
import { PluginDataRepository } from "./persistence/PluginDataRepository";
import { SessionController } from "./session/SessionController";
import { SessionStore } from "./session/SessionStore";
import {
  decodeNoxSettings,
  NOX_SETTINGS_KEY,
  NoxSettings,
} from "./settings/NoxSettings";
import { NoxSettingsTab } from "./settings/SettingsTab";

/**
 * Composition root.
 *
 * Business behavior belongs in LearningController/services; this file only
 * constructs dependencies, registers Obsidian surfaces, and disposes runtime
 * resources.
 */
export default class NoxPlugin extends Plugin {
  private learning!: LearningController;
  private noxSettings!: NoxSettings;
  private pluginData!: PluginDataRepository;
  private vaultPath?: string;
  private runtime?: AgentRuntime;
  private readonly chatGptAuth = new ChatGptAuth();

  async onload(): Promise<void> {
    const vaultAdapter = this.app.vault.adapter;
    this.vaultPath =
      vaultAdapter instanceof FileSystemAdapter
        ? vaultAdapter.getBasePath()
        : undefined;

    this.pluginData = new PluginDataRepository(this);
    this.noxSettings = decodeNoxSettings(await this.pluginData.read());
    const adapter = this.createAdapter(this.noxSettings);
    const runtime = new AgentRuntime(adapter);
    this.runtime = runtime;
    const sessionStore = new SessionStore();
    const sessions = new SessionController(
      this.pluginData,
      sessionStore,
    );

    await Promise.all([
      runtime.init(),
      sessions.init(),
    ]);
    await sessions.configureRuntime(this.noxSettings.provider, this.noxSettings.preferredModel || undefined);
    if (!sessions.getSession().model && this.noxSettings.preferredModel) {
      await sessions.setModel(this.noxSettings.preferredModel);
    }

    const obsidianContext = new ObsidianContext(this.app, this);
    const contexts = new ContextResolver(obsidianContext);
    const policies = new PolicyLoader(this.app);
    const mutations = new MutationService(this.app);
    const learningState = new VaultLearningStore(this.app);

    this.learning = new LearningController(
      sessions,
      runtime,
      contexts,
      policies,
      mutations,
      learningState,
    );

    const logoUrl = this.getLogoUrl().replace(/&/g, "&amp;");
    addIcon(
      "nox-logo",
      `<image href="${logoUrl}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />`,
    );

    this.registerView(
      NOX_VIEW_TYPE,
      (leaf) => new ChatView(
        leaf,
        this.learning,
        () => this.openSettings(),
        () => this.getLogoUrl(),
      ),
    );

    this.addSettingTab(new NoxSettingsTab(this.app, this));

    this.addRibbonIcon(
      "nox-logo",
      "Open Nox",
      () => this.activateView(),
    );

    this.addCommand({
      id: "open-nox-sidebar",
      name: "Open Nox sidebar",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "focus-nox-composer",
      name: "Focus Nox composer",
      hotkeys: [{ modifiers: ["Mod"], key: "l" }],
      callback: async () => {
        await this.activateView();

        setTimeout(() => {
          const leaves = this.app.workspace.getLeavesOfType(NOX_VIEW_TYPE);
          const view = leaves[0]?.view as ChatView | undefined;
          view?.focusComposer();
        }, 100);
      },
    });
  }

  async onunload(): Promise<void> {
    this.runtime?.dispose();
    this.chatGptAuth.dispose();
    this.app.workspace.detachLeavesOfType(NOX_VIEW_TYPE);
    this.learning?.dispose();
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(NOX_VIEW_TYPE);

    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({
      type: NOX_VIEW_TYPE,
      active: true,
    });
    workspace.revealLeaf(leaf);
  }

  getSettings(): NoxSettings {
    return { ...this.noxSettings };
  }

  getLogoUrl(): string {
    const pluginPath = `${this.manifest.dir}/nox.png`;
    return this.app.vault.adapter.getResourcePath(pluginPath);
  }

  async updateSettings(update: Partial<NoxSettings>): Promise<void> {
    const next = { ...this.noxSettings, ...update };
    const runtimeChanged = next.provider !== this.noxSettings.provider ||
      next.executablePath !== this.noxSettings.executablePath ||
      next.codexExecutablePath !== this.noxSettings.codexExecutablePath;
    await this.learning.configureRuntime(next.provider,
      runtimeChanged ? this.createAdapter(next) : undefined,
      next.preferredModel || undefined, {
        updateModel: update.preferredModel !== undefined,
        updateData: (data) => ({ ...data, [NOX_SETTINGS_KEY]: next }),
      });
    this.noxSettings = next;
    await Promise.all(this.app.workspace.getLeavesOfType(NOX_VIEW_TYPE)
      .map((leaf) => (leaf.view as ChatView).refreshRuntime(runtimeChanged)));
  }

  getChatGPTConnection(): ChatGptConnection { return this.chatGptAuth.status(); }

  async connectChatGPT(): Promise<void> {
    const electron = require("electron") as { shell: { openExternal(url: string): Promise<void> } };
    await this.chatGptAuth.signIn((url) => electron.shell.openExternal(url));
    if (this.noxSettings.provider === "chatgpt") {
      await this.runtime?.init();
      await Promise.all(this.app.workspace.getLeavesOfType(NOX_VIEW_TYPE)
        .map((leaf) => (leaf.view as ChatView).refreshRuntime(true)));
    }
  }

  async disconnectChatGPT(): Promise<void> {
    this.chatGptAuth.signOut();
    if (this.noxSettings.provider === "chatgpt") {
      await this.runtime?.init();
      await Promise.all(this.app.workspace.getLeavesOfType(NOX_VIEW_TYPE)
        .map((leaf) => (leaf.view as ChatView).refreshRuntime(true)));
    }
  }

  private createAdapter(settings: NoxSettings): AgyAdapter | CodexAdapter | ChatGptAdapter {
    return settings.provider === "chatgpt"
      ? new ChatGptAdapter(this.chatGptAuth)
      : settings.provider === "codex"
      ? new CodexAdapter(this.vaultPath, () => ({ executablePath: settings.codexExecutablePath }))
      : new AgyAdapter(this.vaultPath, () => ({ executablePath: settings.executablePath }));
  }

  private openSettings(): void {
    const app = this.app as typeof this.app & {
      setting: {
        open(): void;
        openTabById(id: string): void;
      };
    };
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }
}
