import test from "node:test";
import assert from "node:assert/strict";
import { parseProgramCommand } from "../../../src/domain/learning-program/commands";
test("goal command parses explicit constraints without inventing a deadline", () => {
  const command = parseProgramCommand("/plan Learn conversational Spanish | minutes=30 | sessions=5 | exclude=poetry,history");
  assert.equal(command?.kind, "plan");
  if (command?.kind !== "plan") return;
  assert.equal(command.goal, "Learn conversational Spanish");
  assert.equal(command.constraints.deadline, undefined);
  assert.equal(command.constraints.minutesPerSession, 30);
  assert.deepEqual(command.constraints.excludedTopics, ["poetry", "history"]);
});
test("source-bound programs defer active-source resolution to Obsidian", () => {
  const command = parseProgramCommand("/plan Understand this note | sources=active");
  assert.equal(command?.kind, "plan");
  if (command?.kind !== "plan") return;
  assert.equal(command.constraints.sourceBound, true);
  assert.deepEqual(command.constraints.sourcePaths, []);
});
test("unknown options cannot silently override hard constraints", () => {
  assert.throws(() => parseProgramCommand("/plan Test | budget=none"), /Unknown/);
  assert.throws(() => parseProgramCommand("/plan Test | minutes=4"), /Minutes/);
  assert.throws(() => parseProgramCommand("/plan"), /Usage/);
});
test("plain requests and known learning commands are distinct", () => {
  assert.equal(parseProgramCommand("What is a neuron?"), null);
  assert.deepEqual(parseProgramCommand("/next"), { kind: "next" });
  assert.deepEqual(parseProgramCommand("/start-session"), { kind: "start-session" });
});

test("objective focus and replan are explicit commands, not model prompts", () => {
  assert.deepEqual(parseProgramCommand("/focus evidence_1"),
    { kind: "focus", objectiveId: "evidence_1" });
  assert.deepEqual(parseProgramCommand("/pause-focus"), { kind: "pause-focus" });
  assert.deepEqual(parseProgramCommand("/resume-focus"), { kind: "resume-focus" });
  assert.deepEqual(parseProgramCommand("/end-focus"), { kind: "end-focus" });
  assert.deepEqual(parseProgramCommand("/replan"), { kind: "replan" });
  assert.throws(() => parseProgramCommand("/focus ../vault"), /objective-id/);
});

test("curriculum preview commands require an explicit structured edit and separate approval", () => {
  const action = { kind: "change-prerequisites", objectiveId: "apply",
    prerequisiteIds: ["new-foundations"],
    rationale: "The learner has an explicit new prerequisite" };
  const parsed = parseProgramCommand("/curriculum-preview " + JSON.stringify(action));
  assert.deepEqual(parsed, { kind: "curriculum-preview",
    action: { kind: "change-prerequisites", objectiveId: "apply",
      prerequisiteIds: ["new-foundations"] }, rationale: action.rationale });
  assert.deepEqual(parseProgramCommand("/curriculum-approve manual:abc"),
    { kind: "curriculum-approve", operationId: "manual:abc" });
  assert.throws(() => parseProgramCommand("/curriculum-preview not-json"), /valid JSON/);
  assert.throws(() => parseProgramCommand("/curriculum-preview {}"), /kind, objectiveId/);
  assert.throws(() => parseProgramCommand("/curriculum-preview " + JSON.stringify({
    ...action, unauthorized: "override",
  })), /unsupported properties/);
  assert.throws(() => parseProgramCommand("/curriculum-approve ../directory"), /operation-id/);
});
