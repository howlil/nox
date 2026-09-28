import { addIcon, FileSystemAdapter, Plugin } from "obsidian";
import { AgyAdapter } from "./agent/AgyAdapter";
import { ChatView, NOX_VIEW_TYPE } from "./chat/ChatView";
import { ContextResolver } from "./context/ContextResolver";
import { ObsidianContext } from "./context/ObsidianContext";
import { PolicyLoader } from "./context/PolicyLoader";
import { LearningController } from "./learning/LearningController";
import { MutationService } from "./mutation/MutationService";
import { VaultLearningStore } from "./persistence/VaultLearningStore";
import { PluginDataRepository } from "./persistence/PluginDataRepository";
import { SessionController } from "./session/SessionController";
import { SessionStore } from "./session/SessionStore";
import {
  decodeNoxSettings,
  NoxSettings,
  saveNoxSettings,
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

  async onload(): Promise<void> {
    const vaultAdapter = this.app.vault.adapter;
    const vaultPath =
      vaultAdapter instanceof FileSystemAdapter
        ? vaultAdapter.getBasePath()
        : undefined;

    this.pluginData = new PluginDataRepository(this);
    this.noxSettings = decodeNoxSettings(await this.pluginData.read());
    const adapter = new AgyAdapter(vaultPath, () => ({
      executablePath: this.noxSettings.executablePath,
    }));
    const sessionStore = new SessionStore();
    const sessions = new SessionController(
      this.pluginData,
      sessionStore,
      adapter,
    );

    await sessions.init();
    if (!sessions.getSession().model && this.noxSettings.preferredModel) {
      sessions.setModel(this.noxSettings.preferredModel);
    }

    const obsidianContext = new ObsidianContext(this.app, this);
    const contexts = new ContextResolver(obsidianContext);
    const policies = new PolicyLoader(this.app);
    const mutations = new MutationService(this.app);
    const learningState = new VaultLearningStore(this.app);

    this.learning = new LearningController(
      sessions,
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
    this.noxSettings = { ...this.noxSettings, ...update };
    await saveNoxSettings(this.pluginData, this.noxSettings);
    if (update.preferredModel !== undefined) {
      this.learning.setModel(update.preferredModel || undefined);
    }
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
