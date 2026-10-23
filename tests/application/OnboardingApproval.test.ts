import assert from "node:assert/strict";
import test from "node:test";
import { LearningController, OnboardingReceiptWriteError } from "../../src/application/LearningController";
import type { OnboardingDraft } from "../../src/domain/onboarding/types";
import type { LearningProgram } from "../../src/domain/learning-program/types";

const draft: OnboardingDraft = {
  version: 1, stage: "preview", goal: "Learn reliable APIs",
  interests: [], purpose: "career", level: "beginner",
  minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
};
const program = {
  version: 1, id: "11111111-1111-4111-8111-111111111111",
  goal: draft.goal, createdAt: 1, planVersion: 1, objectives: [],
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false, sourcePaths: [], excludedTopics: [] },
} as LearningProgram;
const operationId = "22222222-2222-4222-8222-222222222222";

function rig(failReceipt = false, failWorkspace = false) {
  const events: string[] = [];
  let receipt: OnboardingDraft | undefined;
  const onboardingState = {
    saveDraft: async (value: OnboardingDraft) => {
      events.push("receipt");
      if (failReceipt) throw new Error("disk failure");
      receipt = structuredClone(value);
    },
  };
  const programs = {
    isPlanning: () => false,
    commitPrepared: async (id: string, operation: string, workspace: boolean) => {
      events.push("commit:" + workspace);
      assert.equal(id, program.id);
      assert.equal(operation, operationId);
      assert.deepEqual(receipt?.approval, { programId: id, operationId: operation, withWorkspace: workspace });
      return { ...program, workspaceApproved: workspace };
    },
  };
  const writer = { ensure: async () => {
    events.push("workspace");
    if (failWorkspace) throw new Error("workspace unavailable");
  } };
  const controller = new LearningController({} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never,
    { onboardingState: onboardingState as never, workspaceWriter: writer },
    programs as never);
  return { controller, events, getReceipt: () => receipt };
}

test("application prevents any program commit if its durable receipt fails", async () => {
  const { controller, events } = rig(true);
  await assert.rejects(controller.approveOnboarding(draft, program.id, operationId, true),
    OnboardingReceiptWriteError);
  assert.deepEqual(events, ["receipt"]);
});

test("application commits only after receipt and keeps receipt after workspace failure", async () => {
  const { controller, events, getReceipt } = rig(false, true);
  await assert.rejects(controller.approveOnboarding(draft, program.id, operationId, true),
    /workspace unavailable/);
  assert.deepEqual(events, ["receipt", "commit:true", "workspace"]);
  assert.deepEqual(getReceipt()?.approval, { programId: program.id, operationId, withWorkspace: true });
});

test("plan-only onboarding records matching intent without creating workspace files", async () => {
  const { controller, events } = rig();
  const committed = await controller.approveOnboarding(draft, program.id, operationId, false);
  assert.equal(committed.id, program.id);
  assert.deepEqual(events, ["receipt", "commit:false"]);
});
