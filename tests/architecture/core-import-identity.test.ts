import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentRuntime as PublicAgentRuntime,
  LearningController as PublicLearningController,
  LearningProgramOrchestrator as PublicProgramOrchestrator,
  SessionController as PublicSessionController,
  SessionStore as PublicSessionStore,
  ContextResolver as PublicContextResolver,
  LocalResearchIndex as PublicLocalResearchIndex,
  validateProgram as PublicValidateProgram,
  LearningStateWriteConflict as PublicConflict,
  PersistenceError as PublicPersistenceError,
  ProgramWriteConflict as PublicProgramConflict,
} from "@nox/core";
import { AgentRuntime } from "../../src/agent/AgentRuntime";
import { LearningController } from "../../src/application/LearningController";
import { LearningProgramOrchestrator } from "../../src/application/LearningProgramOrchestrator";
import { SessionController } from "../../src/session/SessionController";
import { SessionStore } from "../../src/session/SessionStore";
import { ContextResolver } from "../../src/context/ContextResolver";
import { LocalResearchIndex } from "../../src/context/LocalResearch";
import { validateProgram } from "../../src/domain/learning-program/collection-schema";
import { LearningStateWriteConflict, PersistenceError, ProgramWriteConflict } from "../../src/domain/persistence/errors";

test("M5 public core API resolves the exact canonical constructors", () => {
  assert.strictEqual(PublicAgentRuntime, AgentRuntime);
  assert.strictEqual(PublicLearningController, LearningController);
  assert.strictEqual(PublicProgramOrchestrator, LearningProgramOrchestrator);
  assert.strictEqual(PublicSessionController, SessionController);
  assert.strictEqual(PublicSessionStore, SessionStore);
  assert.strictEqual(PublicContextResolver, ContextResolver);
  assert.strictEqual(PublicLocalResearchIndex, LocalResearchIndex);
  assert.strictEqual(PublicValidateProgram, validateProgram);
  assert.strictEqual(PublicConflict, LearningStateWriteConflict);
  assert.strictEqual(PublicPersistenceError, PersistenceError);
  assert.strictEqual(PublicProgramConflict, ProgramWriteConflict);
});
