import assert from "node:assert/strict";
import test from "node:test";
import { LearningController } from "../../src/application/LearningController";
import type { LearningProgram } from "../../src/domain/learning-program/types";

const program: LearningProgram = {
  version: 1, id: "11111111-1111-4111-8111-111111111111",
  creationOperationId: "22222222-2222-4222-8222-222222222222",
  goal: "Learn resilient systems", createdAt: 1, planVersion: 1,
  workspaceApproved: true,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false, sourcePaths: [], excludedTopics: [] },
  objectives: [],
};
const receipt = {
  programId: program.id, operationId: program.creationOperationId!,
  withWorkspace: true,
};

function recoveryRig(saved: LearningProgram[] = [program], activeProgramId: string | undefined = program.id) {
  const ensured: string[] = [];
  let blocked = false;
  const writer = { ensure: async (p: LearningProgram) => {
    ensured.push(p.id);
    if (blocked) throw Error("Cannot materialize workspace");
  } };
  const orchestrator = {
    listPrograms: async () => ({ version: 1, activeProgramId, programs: saved }),
  };
  const controller = new LearningController(
    {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, { workspaceWriter: writer }, orchestrator as never,
  );
  return { controller, ensured, block: () => { blocked = true; } };
}

test("M4 recovery matches exact program and operation receipts before any workspace I/O", async () => {
  const rig = recoveryRig();
  assert.equal(await rig.controller.recoverOnboardingApproval({
    ...receipt, operationId: "33333333-3333-4333-8333-333333333333",
  }), null);
  assert.equal(await rig.controller.recoverOnboardingApproval({
    ...receipt, programId: "44444444-4444-4444-8444-444444444444",
  }), null);
  assert.equal(rig.ensured.length, 0);
  assert.equal((await rig.controller.recoverOnboardingApproval(receipt))?.id, program.id);
  assert.deepEqual(rig.ensured, [program.id]);
});

test("M4 plan-only receipt cannot escalate into workspace file writes", async () => {
  const rig = recoveryRig();
  await assert.rejects(
    rig.controller.recoverOnboardingApproval({ ...receipt, withWorkspace: false }),
    /approval intent does not match/,
  );
  assert.equal(rig.ensured.length, 0);
  const planOnly = recoveryRig([{ ...program, workspaceApproved: undefined }]);
  assert.equal((await planOnly.controller.recoverOnboardingApproval({
    ...receipt, withWorkspace: false,
  }))?.id, program.id);
  assert.deepEqual(planOnly.ensured, []);
});

test("M4 changed active program does not materialize a mismatched approval", async () => {
  const rig = recoveryRig([program], "other-program");
  await assert.rejects(rig.controller.recoverOnboardingApproval(receipt), /Another learning program/);
  assert.equal(rig.ensured.length, 0);
});

test("M4 workspace materialization failures propagate and remain safely retryable", async () => {
  const rig = recoveryRig();
  rig.block();
  await assert.rejects(rig.controller.recoverOnboardingApproval(receipt), /Cannot materialize/);
  assert.deepEqual(rig.ensured, [program.id]);
});
