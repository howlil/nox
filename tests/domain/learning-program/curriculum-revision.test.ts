import assert from "node:assert/strict";
import test from "node:test";
import { applyCurriculumRevision, proposeRemediationRevision } from "../../../src/domain/learning-program/curriculum-revision";
import { projectObjectiveLearnerModel } from "../../../src/domain/learner-model/projection";
import type { LearningProgram } from "../../../src/domain/learning-program/types";
import type { LearningEvidence } from "../../../src/domain/learning-state/types";

const program: LearningProgram = {
  version: 1, id: "math", goal: "Understand equations", createdAt: 10, planVersion: 1,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourcePaths: [],
    sourceBound: false, excludedTopics: [] },
  objectives: [{ id: "equations", title: "Equations", outcome: "Solve equations",
    rubric: ["Explain each transformation"], prerequisiteIds: [], sourceRefs: [],
    estimatedMinutes: 40, priority: "core" }],
};
const failure = (id: string, createdAt: number): LearningEvidence => ({
  id, type: "practice", scope: "learner", programId: "math", objectiveId: "equations",
  concept: "Equations", source: "learning-session", outcome: "incorrect", createdAt,
  rubricResults: [{ criterion: "Explain each transformation", met: false, evidence: "Skipped step" }],
});

test("two independent rubric failures propose a versioned DAG remediation", () => {
  assert.equal(proposeRemediationRevision(program, [failure("a", 100)]), null);
  const proposal = proposeRemediationRevision(program, [failure("a", 100), failure("b", 200)])!;
  assert.deepEqual(proposal.reasonEvidenceIds, ["a", "b"]);
  const revised = applyCurriculumRevision(program, proposal);
  assert.equal(revised.planVersion, 2);
  assert.equal(revised.curriculumRevisions?.length, 1);
  assert.equal(revised.objectives.length, 2);
  assert.ok(revised.objectives.find(x => x.id === "equations")?.prerequisiteIds.includes(proposal.addedObjective.id));
  assert.equal(applyCurriculumRevision(revised, proposal), revised);
  assert.throws(() => applyCurriculumRevision({ ...program, planVersion: 4 }, proposal), /version conflict/);
});

test("pinned curricula are immutable and evidence does not leak across programs", () => {
  const proposal = proposeRemediationRevision(program, [failure("a", 100), failure("b", 200)])!;
  assert.throws(() => applyCurriculumRevision({ ...program, focus: {
    id: "f", programId: "math", objectiveId: "equations", curriculumRevision: 1,
    status: "active", startedAt: 10 } }, proposal), /focus/);
  const view = projectObjectiveLearnerModel(program, "equations", [
    failure("a", 100), { ...failure("other", 500), programId: "foreign" },
  ], []);
  assert.equal(view.attempts, 1);
  assert.equal(view.criteria[0].status, "needs-repair");
});
