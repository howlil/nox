import { addIcon, FileSystemAdapter, TFile, Plugin, requestUrl } from "obsidian";
import { shell } from "electron";
import { AgyAdapter } from "./agent/AgyAdapter";
import { CodexAdapter } from "./agent/CodexAdapter";
import { ChatGptAdapter } from "./agent/ChatGptAdapter";
import { ChatGptAuth, type ChatGptConnection } from "./agent/ChatGptAuth";
import { createObsidianOAuthFetch } from "./agent/ObsidianOAuthTransport";
import { createObsidianInferenceFetch } from "./agent/ObsidianInferenceTransport";
import { createNodeInferenceFetch } from "./agent/NodeInferenceTransport";
import { AgentRuntime } from "./agent/AgentRuntime";
import { QuotaSync } from "./application/QuotaSync";
import { ChatView, NOX_VIEW_TYPE } from "./chat/ChatView";
import { ContextResolver } from "./context/ContextResolver";
import { ObsidianContext } from "./context/ObsidianContext";
import { PolicyLoader } from "./context/PolicyLoader";
import { LearningController } from "./application/LearningController";
import { MutationService } from "./mutation/MutationService";
import { VaultLearningStore } from "./persistence/VaultLearningStore";
import { VaultProgramStore } from "./persistence/VaultProgramStore";
import { VaultWorkspaceWriter } from "./persistence/VaultWorkspaceWriter";
import { OnboardingStateRepository } from "./persistence/OnboardingStateRepository";
import { LearningProgramOrchestrator } from "./application/LearningProgramOrchestrator";
import { PluginDataRepository } from "./persistence/PluginDataRepository";
import { TokenUsageRepository } from "./persistence/TokenUsageRepository";
import { SessionController } from "./session/SessionController";
import { SessionStore } from "./session/SessionStore";
import {
  decodeNoxSettings,
  NOX_SETTINGS_KEY,
  NoxSettings,
} from "./settings/NoxSettings";
import { NoxSettingsTab } from "./settings/SettingsTab";

// Values are injected into the actual production bundle by esbuild. They are
// not read from a manifest that could be newer than the loaded JavaScript.
declare const __NOX_LOGO_DATA_URI__: string;
declare const __NOX_BUILD_REVISION__: string;
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
    const adapter = this.createAdapter(this.noxSettings);
    const runtime = new AgentRuntime(adapter,
      (usage, model, metadata) => this.tokenUsage.record(this.noxSettings.provider, model, usage, metadata));
    this.runtime = runtime;
    const sessionStore = new SessionStore();
    const sessions = new SessionController(
      this.pluginData,
      sessionStore,
    );

    // Local sessions must load even if the selected CLI is absent or hung.
    // Model discovery is performed only when the model picker is opened.
    await sessions.init();
    await sessions.configureRuntime(this.noxSettings.provider, this.noxSettings.preferredModel || undefined);
    if (!sessions.getSession().model && this.noxSettings.preferredModel) {
      await sessions.setModel(this.noxSettings.preferredModel);
    }

    const obsidianContext = new ObsidianContext(this.app, this);
    const contexts = new ContextResolver(obsidianContext);
    const policies = new PolicyLoader(this.app);
    const mutations = new MutationService(this.app);
    const learningState = new VaultLearningStore(this.app);
    const programStore = new VaultProgramStore(this.app);
    const workspaceWriter = new VaultWorkspaceWriter(this.app);
    const programs = new LearningProgramOrchestrator(
      runtime, contexts, learningState, programStore,
      () => sessions.getSession().model,
      () => sessions.getSession().runtimeProvider,
    );
    let lastInteraction = Date.now();
    let idle = false;
    const observeInteraction = () => {
      lastInteraction = Date.now();
      if (idle) {
        idle = false;
        void programs.setIdle(false).catch(error => console.warn("[Nox] Idle resume failed", error));
      }
    };
    this.registerDomEvent(document, "keydown", observeInteraction);
    this.registerDomEvent(document, "pointerdown", observeInteraction);
    this.registerDomEvent(document, "scroll", observeInteraction, true);
    this.registerInterval(window.setInterval(() => {
      if (!idle && Date.now() - lastInteraction >= 180_000) {
        idle = true;
        void programs.setIdle(true).catch(error => console.warn("[Nox] Idle checkpoint failed", error));
      }
    }, 30_000));
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (file?.extension === "md") void programs.focusMaterial(file.path).catch(() => {});
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension === "md") {
        void programs.renameMaterial(oldPath, file.path).catch(() => {});
      }
    }));
    this.registerDomEvent(document, "visibilitychange", () => {
      void programs.setAppInactive(document.hidden).catch(error =>
        console.warn("[Nox] Could not save visibility pause", error));
    });

    // Do not charge inactive wall-clock time after Obsidian restart or hot reload.
    try { await programs.recoverSessions(); }
    catch (error) { console.warn("[Nox] Learning session recovery failed", error); }

    this.learning = new LearningController(
      sessions,
      runtime,
      contexts,
      policies,
      mutations,
      learningState,
      { programStore, workspaceWriter, onboardingState: new OnboardingStateRepository(this.pluginData) },
      programs,
    );

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

  getBuildDiagnostics(): { revision: string; builtAt: string; transport: string; pluginDir: string; vaultDir: string } {
    return {
      revision: __NOX_BUILD_REVISION__,
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
