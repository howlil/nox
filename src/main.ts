import { addIcon, FileSystemAdapter, Notice, Plugin, requestUrl } from "obsidian";
import { shell } from "electron";
import { AgyAdapter } from "./agent/AgyAdapter";
import { CodexAdapter } from "./agent/CodexAdapter";
import { ChatGptAdapter } from "./agent/ChatGptAdapter";
import { ChatGptAuth, type ChatGptConnection } from "./agent/ChatGptAuth";
import { createObsidianOAuthFetch } from "./agent/ObsidianOAuthTransport";
import { createObsidianInferenceFetch } from "./agent/ObsidianInferenceTransport";
import { createNodeInferenceFetch } from "./agent/NodeInferenceTransport";
import { QuotaSync } from "./application/QuotaSync";
import type { AgentRuntime, LearningController } from "@nox/core";
import { createObsidianLearningHost } from "./host/obsidian/composition";
import { bindObsidianLearningLifecycle } from "./host/obsidian/lifecycle";
import { BackgroundWriteFeedback } from "./host/obsidian/background-write-feedback";
import { ChatView, NOX_VIEW_TYPE } from "./chat/ChatView";
import { PluginDataRepository } from "./persistence/PluginDataRepository";
import { TokenUsageRepository } from "./persistence/TokenUsageRepository";
import {
  decodeNoxSettings,
  NOX_SETTINGS_KEY,
  NoxSettings,
} from "./settings/NoxSettings";
import { NoxSettingsTab } from "./settings/SettingsTab";
import { runtimeProvenanceReport } from "./diagnostics/runtime-provenance";

// Values are injected into the actual production bundle by esbuild. They are
// not read from a manifest that could be newer than the loaded JavaScript.
declare const __NOX_LOGO_DATA_URI__: string;
declare const __NOX_BUILD_REVISION__: string;
declare const __NOX_SOURCE_SHA__: string;
declare const __NOX_BUILD_TIMESTAMP__: string;
declare const __NOX_BUILD_TRANSPORT__: string;

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
  private tokenUsage!: TokenUsageRepository;
  private quotaSync!: QuotaSync;
  private vaultPath?: string;
  private runtime?: AgentRuntime;
  // Use the Obsidian HTTP stack for OAuth instead of renderer/Node global fetch.
  private readonly chatGptAuth = new ChatGptAuth({ fetch: createObsidianOAuthFetch(requestUrl) });

  async onload(): Promise<void> {
    const vaultAdapter = this.app.vault.adapter;
    this.vaultPath =
      vaultAdapter instanceof FileSystemAdapter
        ? vaultAdapter.getBasePath()
        : undefined;

    this.pluginData = new PluginDataRepository(this);
    this.tokenUsage = new TokenUsageRepository(this.pluginData);
    this.noxSettings = decodeNoxSettings(await this.pluginData.read());
    this.quotaSync = this.createQuotaSync(this.noxSettings);
    const backgroundWrites = new BackgroundWriteFeedback(message => { new Notice(message); });
    const host = await createObsidianLearningHost({
      plugin: this,
      app: this.app,
      data: this.pluginData,
      adapter: this.createAdapter(this.noxSettings),
      provider: this.noxSettings.provider,
      preferredModel: this.noxSettings.preferredModel || undefined,
      onUsage: (usage, model, metadata) =>
        this.tokenUsage.record(this.noxSettings.provider, model, usage, metadata),
      onCheckpointResult: error => {
        if (error === null) backgroundWrites.success("checkpoint");
        else backgroundWrites.failure("checkpoint", error);
      },
    });
    this.runtime = host.runtime;
    // Listener ownership stays with Obsidian and its Plugin.register* cleanup.
    bindObsidianLearningLifecycle(this, host.programs, backgroundWrites);

    // Do not charge inactive wall-clock time after Obsidian restart or hot reload.
    try { await host.programs.recoverSessions(); }
    catch (error) { console.warn("[Nox] Learning session recovery failed", error); }

    this.learning = host.learning;

    // Recover only user-approved workspaces. Legacy /plan programs never scaffold files.
    this.app.workspace.onLayoutReady(() => {
      void this.learning.recoverLearningWorkspaces().catch(error =>
        console.warn("[Nox] Approved workspace recovery requires attention", error));
    });

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
      id: "open-sidebar",
      name: "Open sidebar",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "copy-runtime-diagnostics",
      name: "Copy runtime diagnostics",
      callback: async () => {
        try {
          const report = await runtimeProvenanceReport(this.getBuildDiagnostics());
          await navigator.clipboard.writeText(report);
          new Notice("NOX runtime diagnostic copied. Redact local paths before sharing.");
        } catch {
          new Notice("Unable to copy runtime diagnostics. Check clipboard permissions.");
        }
      },
    });

    this.addCommand({
      id: "guided-learning-setup",
      name: "Open guided learning setup",
      callback: async () => {
        try {
          await this.activateView();
          const view = this.app.workspace.getLeavesOfType(NOX_VIEW_TYPE)[0]?.view as ChatView | undefined;
          await view?.beginGuidedOnboarding();
        } catch (error) {
          console.warn("[Nox] Guided learning setup unavailable", error);
        }
      },
    });

    this.addCommand({
      id: "focus-composer",
      name: "Focus composer",
      callback: async () => {
        await this.activateView();

        window.setTimeout(() => {
          const leaves = this.app.workspace.getLeavesOfType(NOX_VIEW_TYPE);
          const view = leaves[0]?.view as ChatView | undefined;
          view?.focusComposer();
        }, 100);
      },
    });

  }

  onunload(): void {
    this.runtime?.dispose();
    this.quotaSync?.dispose();
    this.chatGptAuth.dispose();
    // Obsidian does not await a Promise returned by Plugin.onunload.
    // Start a final checkpoint and observe failures; dispose the learning
    // owner once its persistence operation has settled.
    const learning = this.learning;
    if (learning) {
      void learning.flushSessionTime()
        .catch(error => console.warn("[Nox] Final learning time checkpoint failed", error))
        .finally(() => learning.dispose());
    }
    // Preserve workspace layout on plugin disable/reload; Obsidian owns leaf disposal.
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(NOX_VIEW_TYPE);

    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({
      type: NOX_VIEW_TYPE,
      active: true,
    });
    await workspace.revealLeaf(leaf);
  }

  getSettings(): NoxSettings {
    return { ...this.noxSettings };
  }

  getLogoUrl(): string {
    return __NOX_LOGO_DATA_URI__;
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
    if (runtimeChanged) {
      this.quotaSync.dispose();
      this.quotaSync = this.createQuotaSync(next);
    }
    await Promise.all(this.app.workspace.getLeavesOfType(NOX_VIEW_TYPE)
      .map((leaf) => (leaf.view as ChatView).refreshRuntime(runtimeChanged)));
  }

  getTokenUsageSnapshot(): ReturnType<TokenUsageRepository["snapshot"]> {
    return this.tokenUsage.snapshot();
  }

  getProviderQuotas(force = false) { return this.quotaSync.read(force); }

  getTokenUsageError(): string | undefined {
    return this.runtime?.getUsageTrackingError();
  }

  getBuildDiagnostics(): { revision: string; sourceSha: string; builtAt: string; transport: string; pluginDir: string; vaultDir: string } {
    return {
      revision: __NOX_BUILD_REVISION__,
      sourceSha: __NOX_SOURCE_SHA__,
      builtAt: __NOX_BUILD_TIMESTAMP__,
      transport: __NOX_BUILD_TRANSPORT__,
      pluginDir: this.manifest.dir ?? "(unknown plugin directory)",
      vaultDir: this.vaultPath ?? "(non-file-system vault)",
    };
  }

  getChatGPTConnection(): ChatGptConnection { return this.chatGptAuth.status(); }

  recoverChatGPTStorage(): void { this.chatGptAuth.repairStorage(); }

  async connectChatGPT(): Promise<void> {
    await this.chatGptAuth.signIn((url) => shell.openExternal(url));
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

  private createQuotaSync(settings: NoxSettings): QuotaSync {
    // Dedicated short-lived read-only sessions. They never share a conversation
    // or write token usage, login credentials, or manual balance snapshots.
    const agy = new AgyAdapter(this.vaultPath,
      () => ({ executablePath: settings.executablePath }));
    const codex = new CodexAdapter(this.vaultPath,
      () => ({ executablePath: settings.codexExecutablePath }));
    return new QuotaSync({
      agy: signal => agy.readQuota(signal),
      codex: signal => codex.readQuota(signal),
    });
  }

  private createAdapter(settings: NoxSettings): AgyAdapter | CodexAdapter | ChatGptAdapter {
    return settings.provider === "chatgpt"
      ? new ChatGptAdapter(this.chatGptAuth, { fetch: createNodeInferenceFetch(createObsidianInferenceFetch(requestUrl)) })
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
