import type { App, Plugin } from "obsidian";
import { AgentRuntime } from "../../agent/AgentRuntime";
import { LearningController } from "../../application/LearningController";
import { LearningProgramOrchestrator } from "../../application/LearningProgramOrchestrator";
import { ContextResolver } from "../../context/ContextResolver";
import { ObsidianContext } from "../../context/ObsidianContext";
import { PolicyLoader } from "../../context/PolicyLoader";
import { MutationService } from "../../mutation/MutationService";
import { VaultLearningStore } from "../../persistence/VaultLearningStore";
import { VaultProgramStore } from "../../persistence/VaultProgramStore";
import { VaultWorkspaceWriter } from "../../persistence/VaultWorkspaceWriter";
import { OnboardingStateRepository } from "../../persistence/OnboardingStateRepository";
import { PluginDataRepository } from "../../persistence/PluginDataRepository";
import { SessionController } from "../../session/SessionController";
import { SessionStore } from "../../session/SessionStore";
import type { AgentAdapter } from "../../types";

/**
 * Obsidian composition adapter — no parallel state owner or new persistence
 * contract. Both session and settings must keep the SAME plugin-data writer.
 * Only the host knows Obsidian vault, editor and policy implementations.
 */
export async function createObsidianLearningHost(options: {
  plugin: Plugin;
  app: App;
  data: PluginDataRepository;
  adapter: AgentAdapter;
  provider: string;
  preferredModel?: string;
  onUsage: ConstructorParameters<typeof AgentRuntime>[1];
}): Promise<{
  learning: LearningController;
  programs: LearningProgramOrchestrator;
  runtime: AgentRuntime;
  sessions: SessionController;
}> {
  const { plugin, app, data, adapter, provider, preferredModel, onUsage } = options;
  const runtime = new AgentRuntime(adapter, onUsage);
  try {
    const sessions = new SessionController(data, new SessionStore());
    // Startup must not depend on provider model discovery or a working CLI.
    await sessions.init();
    await sessions.configureRuntime(provider, preferredModel);
    if (!sessions.getSession().model && preferredModel) {
      await sessions.setModel(preferredModel);
    }

    const contexts = new ContextResolver(new ObsidianContext(app, plugin));
    const policies = new PolicyLoader(app);
    const mutations = new MutationService(app);
    const learningState = new VaultLearningStore(app);
    const programStore = new VaultProgramStore(app);
    const workspaceWriter = new VaultWorkspaceWriter(app);
    const programs = new LearningProgramOrchestrator(
      runtime, contexts, learningState, programStore,
      () => sessions.getSession().model,
      () => sessions.getSession().runtimeProvider,
    );
    const learning = new LearningController(
      sessions, runtime, contexts, policies, mutations, learningState,
      { programStore, workspaceWriter, onboardingState: new OnboardingStateRepository(data) },
      programs,
    );
    return { learning, programs, runtime, sessions };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}
