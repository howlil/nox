import assert from "node:assert/strict";
import test from "node:test";
import { LearningProgramOrchestrator } from "../../src/application/LearningProgramOrchestrator";
import { selectAdaptiveActivity } from "../../packages/core/src/domain/learner-model/activity-policy";
import type { LearningEvidence, LearningState } from "../../packages/core/src/domain/learning-state/types";
import type { LearningProgram, ProgramCollection } from "../../packages/core/src/domain/learning-program/types";

const NOW = Date.UTC(2026, 9, 18, 8);
function program(version = 2): LearningProgram {
  return { version: 2, id: "program-1", goal: "Database concurrency", createdAt: 1,
    planVersion: version, constraints: {
      minutesPerSession: 45, sessionsPerWeek: 3,
      sourcePaths: [], sourceBound: false, excludedTopics: [],
    }, objectives: [
      { id: "basics", title: "Lock basics", outcome: "Explain lock isolation",
        prerequisiteIds: [], rubric: ["Explain isolation"], estimatedMinutes: 30,
        priority: "core", sourceRefs: [], objectiveRevision: version },
      { id: "advanced", title: "Concurrent transactions", outcome: "Debug races",
        prerequisiteIds: ["basics"], rubric: ["Prevent races"], estimatedMinutes: 50,
        priority: "core", sourceRefs: [], objectiveRevision: version },
    ] };
}
function attempt(id: string, revision: number, at: number, taskKind: "recall" | "guided-practice"): LearningEvidence {
  return { id, type: "practice", scope: "learner", concept: "basics",
    source: "lesson", outcome: "correct", createdAt: at, programId: "program-1",
    objectiveId: "basics", objectiveRevision: revision, evidenceVersion: 3,
    questionId: "q-" + id, taskKind, evaluator: "llm-review",
    assistance: { highestHintLevel: 0, independent: true },
    rubricResults: [{ criterion: "Explain isolation",
      criterionId: "basics@" + revision + ":criterion-1", met: true, evidence: "verified" }],
  };
}
function setup(p: LearningProgram, evidence: LearningEvidence[]) {
  const saved: ProgramCollection = { version: 2,
    activeProgramId: p.id, programs: [structuredClone(p)] };
  let commits = 0;
  const state: LearningState = { version: 3, target: null, evidence, gaps: [] };
  const orchestration = new LearningProgramOrchestrator(
    {} as never, {} as never,
    { load: async () => structuredClone(state) } as never,
    { load: async () => structuredClone(saved),
      save: async (value: ProgramCollection) => {
        commits++; saved.programs = structuredClone(value.programs);
        saved.activeProgramId = value.activeProgramId;
      },
    } as never, () => undefined, () => "chatgpt", () => NOW,
  );
  return { orchestration, state, p: () => structuredClone(saved.programs[0]),
    commits: () => commits };
}

test("runtime getDecision shares deterministic M4 policy with read-only orchestration", async () => {
  const rig = setup(program(2), []);
  const selected = await rig.orchestration.getDecision();
  assert.deepEqual(selected?.decision, selectAdaptiveActivity(rig.p(), rig.state, NOW));
  assert.equal(rig.commits(), 0, "decisions cannot mutate the vault");
  rig.orchestration.dispose();
});

test("legacy rubric evidence cannot bypass focus prerequisite after structural revision", async () => {
  const old = [
    attempt("old-1", 1, NOW - 15 * 3_600_000, "guided-practice"),
    attempt("old-2", 1, NOW - 3_600_000, "recall"),
  ];
  const rig = setup(program(2), old);
  const result = await rig.orchestration.getDecision();
  assert.equal(result?.decision.kind, "diagnostic");
  assert.equal(result?.decision.objective?.id, "basics");
  await assert.rejects(rig.orchestration.startFocus("advanced", "chat-a"), /Prerequisites are not mastered/);
  assert.equal(rig.commits(), 0);
  assert.match(await rig.orchestration.progressSummary(), /Mastered: 0\/2/);
  const focused = await rig.orchestration.startFocus("basics", "chat-a");
  assert.equal(focused.focus?.objectiveId, "basics");
  assert.equal((await rig.orchestration.getDecision())?.decision.objective?.id, "basics");
  await rig.orchestration.pauseFocus();
  assert.equal((await rig.orchestration.getDecision())?.decision.kind, "wait");
  rig.orchestration.dispose();
});

test("current revision delayed retrieval allows dependent objective without forced transfer", async () => {
  const events = [
    attempt("current-1", 2, NOW - 15 * 3_600_000, "guided-practice"),
    attempt("current-2", 2, NOW - 3_600_000, "recall"),
  ];
  const rig = setup(program(2), events);
  const result = await rig.orchestration.getDecision();
  assert.equal(result?.decision.kind, "diagnostic");
  assert.equal(result?.decision.objective?.id, "advanced");
  assert.match(await rig.orchestration.progressSummary(), /Mastered: 1\/2/);
  rig.orchestration.dispose();
});
