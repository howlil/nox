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
    rubric: ["Explain each transformation"],
    criteria: [{ id: "c1", description: "Explain each transformation", required: true }],
    prerequisiteIds: [], sourceRefs: [],
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

test("auto-replan accepts only two committed failures in the just-ended focus", () => {
  const focusId = "focus-current";
  const committed = (id: string, at: number, focus = focusId, questionId = id): LearningEvidence => ({
    ...failure(id, at), objectiveRevision: 1, focusSessionId: focus,
    questionId, evaluator: "llm-review", assistance: { highestHintLevel: 0, independent: true },
    rubricResults: [{ criterion: "Explain each transformation", criterionId: "c1",
      met: false, evidence: "Skipped explanation" }],
  });
  const scoped = { completedFocusId: focusId, objectiveId: "equations" };
  const legacy = [failure("old-1", 100), failure("old-2", 200)];
  assert.equal(proposeRemediationRevision(program, legacy, scoped), null);
  const a = committed("a", 100);
  const b = committed("b", 200);
  assert.equal(proposeRemediationRevision(program, [a, b], scoped)?.reasonEvidenceIds.length, 2);
  assert.equal(proposeRemediationRevision(program, [a, { ...b, questionId: "a" }], scoped), null);
  assert.equal(proposeRemediationRevision(program, [a, committed("other", 200, "other-focus")], scoped), null);
  assert.equal(proposeRemediationRevision(program, [a, { ...b, evaluator: "verified-execution" }], scoped), null);
  assert.equal(proposeRemediationRevision(program, [a, { ...b, objectiveRevision: 2 }], scoped), null);
  assert.equal(proposeRemediationRevision(program, [a, { ...b, rubricResults: [
    { criterion: "Explain each transformation", criterionId: "wrong",
      met: false, evidence: "No match" },
  ] }], scoped), null);
  assert.equal(proposeRemediationRevision(program, [a, b, { ...committed("recovered", 300),
    outcome: "correct", rubricResults: [{
      criterion: "Explain each transformation", criterionId: "c1", met: true,
      evidence: "Independent correction",
    }],
  }], scoped), null);
});

test("automatic structural replan is idempotent and never mutates focus or source authority", () => {
  const scope = { completedFocusId: "focus", objectiveId: "equations" };
  const recorded = ["a", "b"].map((id, index): LearningEvidence => ({
    ...failure(id, 100 + index * 100), focusSessionId: "focus",
    objectiveRevision: 1, evaluator: "llm-review", questionId: id,
    rubricResults: [{ criterion: "Explain each transformation",
      criterionId: "c1", met: false, evidence: "Not justified" }],
  }));
  const proposed = proposeRemediationRevision(program, recorded, scope)!;
  const revised = applyCurriculumRevision(program, proposed);
  assert.equal(revised.planVersion, 2);
  assert.equal(revised.focus, undefined);
  assert.deepEqual(revised.objectives.find(item => item.id === proposed.addedObjective.id)?.sourceRefs, []);
  assert.equal(applyCurriculumRevision(revised, proposed), revised);
  assert.equal(proposeRemediationRevision(revised, recorded, scope), null);
});
