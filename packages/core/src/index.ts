/**
 * @nox/core — host-independent NOX application and learning engine API.
 *
 * The implementation is compiled directly from the canonical src/ tree;
 * this facade never copies the engine into a second editable source tree.
 * Do not export Obsidian vault/editor adapters or internal feature modules.
 */
export { AgentRuntime } from "../../../src/agent/AgentRuntime";
export { LearningController } from "../../../src/application/LearningController";
export { LearningProgramOrchestrator } from "../../../src/application/LearningProgramOrchestrator";
export { SessionController } from "../../../src/session/SessionController";
export { SessionStore } from "../../../src/session/SessionStore";
export { ContextResolver } from "../../../src/context/ContextResolver";
export { DEFAULT_LEARNING_STATE } from "../../../src/domain/learning-state/types";
export { decodeLearningState } from "../../../src/persistence/learning-state-schema";
export { PersistenceError, LearningStateWriteConflict } from "../../../src/domain/persistence/errors";

export type {
  AgentAdapter, AgentRuntimePort, AgentHealth, AgentInput,
  AgentModel, AgentStreamEvent, SendOptions, SessionDataPort,
  ChatSession, ChatMessage, AgentFailure, AgentContext, EditProposal,
  ResearchScope, ApplyResult, TokenUsage,
} from "../../../src/types";
export type {
  SessionPort, ContextPort, PolicyPort, MutationPort, LearningStatePort,
  ProgramStorePort, WorkspaceWriterPort, OnboardingStatePort,
} from "../../../src/application/ports";
export type {
  LearningEvent, LearningRequest,
} from "../../../src/application/learning-types";
export type {
  SessionStoreOptions,
} from "../../../src/session/SessionStore";
export type {
  ContextSourcePort,
} from "../../../src/context/ContextSourcePort";
export type {
  LearningContext, LearningPolicy, ExplicitContextRef,
} from "../../../src/context/context-types";
export type {
  LearningState, LearningEvidence, KnowledgeGap,
} from "../../../src/domain/learning-state/types";
export type {
  LearningProgram, ProgramCollection, ProgramConstraints,
} from "../../../src/domain/learning-program/types";
