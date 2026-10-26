/**
 * @nox/core — host-independent NOX application and learning engine API.
 *
 * The application, runtime, session and domain source is now package-owned;
 * this facade never copies the engine into a second editable source tree.
 * Do not export Obsidian vault/editor adapters or internal feature modules.
 */
export { AgentRuntime } from "./agent/AgentRuntime";
export { LearningController } from "./application/LearningController";
export { LearningProgramOrchestrator } from "./application/LearningProgramOrchestrator";
export { SessionController } from "./session/SessionController";
export { SessionStore } from "./session/SessionStore";
export { ContextResolver } from "./context/ContextResolver";
export { LocalResearchIndex } from "./context/LocalResearch";
export { DEFAULT_LEARNING_STATE } from "./domain/learning-state/types";
export { decodeProgramCollection } from "./domain/learning-program/collection-schema";
export { decodeLearningState } from "./persistence/learning-state-schema";
export { PersistenceError, LearningStateWriteConflict, SessionWriteConflict, ProgramWriteConflict } from "./domain/persistence/errors";

export type {
  AgentAdapter, AgentRuntimePort, AgentHealth, AgentInput,
  AgentModel, AgentStreamEvent, SendOptions, SessionDataPort,
  ChatSession, ChatMessage, AgentFailure, AgentContext, EditProposal,
  ResearchScope, ApplyResult, TokenUsage,
} from "./types";
export type {
  SessionPort, ContextPort, PolicyPort, MutationPort, LearningStatePort,
  ProgramStorePort, WorkspaceWriterPort, OnboardingStatePort,
} from "./application/ports";
export type {
  LearningEvent, LearningRequest,
} from "./application/learning-types";
export type {
  SessionStoreOptions,
} from "./session/SessionStore";
export type {
  ContextSourcePort,
} from "./context/ContextSourcePort";
export type { ResearchResult } from "./context/LocalResearch";
export type {
  LearningContext, LearningPolicy, ExplicitContextRef,
} from "./context/context-types";
export type {
  LearningState, LearningEvidence, KnowledgeGap,
} from "./domain/learning-state/types";
export type {
  LearningProgram, ProgramCollection, ProgramConstraints,
} from "./domain/learning-program/types";
