import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentRuntime as PublicAgentRuntime,
  LearningController as PublicLearningController,
  LearningProgramOrchestrator as PublicProgramOrchestrator,
  SessionController as PublicSessionController,
  SessionStore as PublicSessionStore,
  ContextResolver as PublicContextResolver,
  LearningStateWriteConflict as PublicConflict,
  PersistenceError as PublicPersistenceError,
} from "@nox/core";
import { AgentRuntime } from "../../src/agent/AgentRuntime";
import { LearningController } from "../../src/application/LearningController";
import { LearningProgramOrchestrator } from "../../src/application/LearningProgramOrchestrator";
import { SessionController } from "../../src/session/SessionController";
import { SessionStore } from "../../src/session/SessionStore";
import { ContextResolver } from "../../src/context/ContextResolver";
import { LearningStateWriteConflict, PersistenceError } from "../../src/domain/persistence/errors";

test("M5 public core API resolves the exact canonical constructors", () => {
  assert.strictEqual(PublicAgentRuntime, AgentRuntime);
  assert.strictEqual(PublicLearningController, LearningController);
  assert.strictEqual(PublicProgramOrchestrator, LearningProgramOrchestrator);
  assert.strictEqual(PublicSessionController, SessionController);
  assert.strictEqual(PublicSessionStore, SessionStore);
  assert.strictEqual(PublicContextResolver, ContextResolver);
  assert.strictEqual(PublicConflict, LearningStateWriteConflict);
  assert.strictEqual(PublicPersistenceError, PersistenceError);
});
