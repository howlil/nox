import assert from "node:assert/strict";
import test from "node:test";
import { chooseNextActivity, feasibility, objectiveProgress, validateConstraints, validateCurriculum } from "../../../src/domain/learning-program/rules";
import type { LearningProgram, ProgramConstraints } from "../../../src/domain/learning-program/types";
import type { LearningEvidence } from "../../../src/domain/learning-state/types";

const now = new Date("2026-10-14T12:00:00").getTime();
const constraints: ProgramConstraints = {
  minutesPerSession: 45, sessionsPerWeek: 3,
  sourcePaths: [], sourceBound: false, excludedTopics: [],
};
const goal = {
  kind: "curriculum",
  objectives: [
    { id: "symbols", title: "Symbols", outcome: "Identify and manipulate symbols",
      prerequisiteIds: [], estimatedMinutes: 50, rubric: ["Use notation correctly"],
      sourceRefs: [], priority: "core" },
    { id: "equations", title: "Equations", outcome: "Solve equations with explanation",
      prerequisiteIds: ["symbols"], estimatedMinutes: 65,
      rubric: ["Correct transformations"], sourceRefs: [], priority: "core" },
  ],
} as const;
function program(overrides: Partial<LearningProgram> = {}): LearningProgram {
  return { version: 1, id: "math", goal: "Solve equations",
    constraints: { ...constraints }, objectives: validateCurriculum(goal, constraints).objectives,
    createdAt: now, planVersion: 1, ...overrides };
}
const event = (objectiveId: string, outcome: string, createdAt: number,
  assisted = false): LearningEvidence => ({
    id: `${objectiveId}:${createdAt}`, type: "practice", scope: "learner",
    programId: "math", objectiveId, concept: "Algebra", source: "notes.md",
    outcome, assisted, createdAt, taskKind: "guided-practice",
    rubricResults: [{ criterion: objectiveId === "symbols" ? "Use notation correctly" :
      "Correct transformations", met: outcome === "correct", evidence: "Verified" }],
  });

test("curriculum respects prerequisite DAG and cross-domain objectives", () => {
  assert.equal(validateCurriculum(goal, constraints).objectives.length, 2);
  assert.equal(chooseNextActivity(program(), [], now).objective?.id, "symbols");
  assert.equal(chooseNextActivity(program(), [], now).kind, "diagnostic");
});

test("reject cyclic, duplicate and orphaned prerequisite graph", () => {
  const base = structuredClone(goal) as unknown as { kind: string; objectives: Array<{
    id: string; prerequisiteIds: string[];
  } & Record<string, unknown>> };
  base.objectives[0].prerequisiteIds = ["equations"];
  assert.throws(() => validateCurriculum(base, constraints), /cycle/);
  base.objectives[0].prerequisiteIds = [];
  base.objectives[1].id = "symbols";
  assert.throws(() => validateCurriculum(base, constraints), /unique/);
  base.objectives[1].id = "equations";
  base.objectives[1].prerequisiteIds = ["missing"];
  assert.throws(() => validateCurriculum(base, constraints), /Unknown prerequisite/);
});

test("strict source boundary rejects hallucinated or missing source references", () => {
  const scoped = { ...constraints, sourceBound: true, sourcePaths: ["math.md"] };
  assert.throws(() => validateCurriculum(goal, scoped), /missing source/);
  const draft = structuredClone(goal) as unknown as { objectives: Array<{ sourceRefs: string[] }> };
  draft.objectives.forEach(o => { o.sourceRefs = ["outside.md"]; });
  assert.throws(() => validateCurriculum(draft, scoped), /unapproved/);
  draft.objectives.forEach(o => { o.sourceRefs = ["math.md"]; });
  assert.equal(validateCurriculum(draft, scoped).objectives.length, 2);
});

test("invalid deadlines and unrealistic session budgets fail explicitly", () => {
  assert.throws(() => validateConstraints({ ...constraints, minutesPerSession: 4 }), /Minutes/);
  assert.throws(() => validateConstraints({ ...constraints, sessionsPerWeek: 9 }), /Sessions/);
  assert.throws(() => validateConstraints({ ...constraints, deadline: "2026-02-31" }, new Date("2026-01-01")), /Deadline/);
  assert.throws(() => validateConstraints({ ...constraints, sourceBound: true }), /selected note/);
});

test("deadline feasibility reports tradeoffs, not fictional completion", () => {
  const risk = feasibility(program({ constraints: { ...constraints, deadline: "2026-10-15" } }), now);
  assert.equal(risk.feasible, false);
  assert.ok(risk.estimatedMinutes > (risk.availableMinutes ?? 0));
  assert.equal(feasibility(program(), now).feasible, null);
});

test("incorrect response triggers targeted remediation, not progress", () => {
  const events = [event("symbols", "incorrect", now - 2000)];
  assert.equal(chooseNextActivity(program(), events, now).kind, "teach");
  const taught = program({ instructionEvents: [{ objectiveId: "symbols", afterEvidenceAt: now - 2000, taughtAt: now - 1000 }] });
  assert.equal(chooseNextActivity(taught, events, now).kind, "guided-practice");
  assert.equal(chooseNextActivity(program(), events, now).objective?.id, "symbols");
});

test("independent delayed recall is required for mastery; material reviews do not count", () => {
  const first = event("symbols", "correct", now - 2 * 86_400_000);
  assert.equal(objectiveProgress(program(), "symbols", [first], now).status, "provisional");
  assert.equal(chooseNextActivity(program(), [first], now).kind, "recall");
  const material = { ...first, id: "review", type: "review" as const, scope: "material" as const };
  assert.equal(objectiveProgress(program(), "symbols", [material], now).status, "unseen");
  const second = { ...event("symbols", "correct", now), taskKind: "recall" as const };
  assert.equal(objectiveProgress(program(), "symbols", [first, second], now).status, "mastered");
  assert.equal(chooseNextActivity(program(), [first, second], now).kind, "transfer");
});

test("hint-assisted answers never qualify as independent mastery", () => {
  const first = event("symbols", "correct", now - 3 * 86_400_000);
  const aided = event("symbols", "correct", now, true);
  assert.equal(objectiveProgress(program(), "symbols", [first, aided], now).status, "remediate");
});

test("timebox expiry blocks new activity without erasing progress", () => {
  const p = program({ session: { startedAt: now - 50 * 60_000, timeBudgetMinutes: 45,
    timing: { version: 2, activeMs: 45 * 60_000, aiWaitingMs: 5 * 60_000,
      pauseReasons: [], checkpointAt: now } } });
  assert.equal(chooseNextActivity(p, [], now).kind, "timebox-ended");
  assert.equal(chooseNextActivity(p, [], now).minutesRemaining, 0);
});

test("completed transfer task clears transfer gate for next eligible objective", () => {
  const first = event("symbols", "correct", now - 2 * 86_400_000);
  const second = { ...event("symbols", "correct", now - 1000), taskKind: "recall" as const };
  const transfer = { ...event("symbols", "correct", now), taskKind: "transfer" as const };
  const next = chooseNextActivity(program(), [first, second, transfer], now);
  assert.equal(next.objective?.id, "equations");
  assert.equal(next.kind, "diagnostic");
});

test("deadline blocks unapproved new activities", () => {
  const expired = program({ constraints: { ...constraints, deadline: "2026-10-13" } });
  assert.equal(chooseNextActivity(expired, [], now).kind, "wait");
  assert.match(chooseNextActivity(expired, [], now).reason, /deadline/i);
});

test("duplicated rubric criteria are rejected", () => {
  const draft = structuredClone(goal) as unknown as { objectives: Array<{ rubric: string[] }> };
  draft.objectives[0].rubric = ["same", "same"];
  assert.throws(() => validateCurriculum(draft, constraints), /Invalid objective/);
});

test("correct single-item MCQ is formative evidence, not objective mastery", () => {
  const one = {
    ...event("symbols", "correct", now - 24 * 60 * 60 * 1000),
    assessmentCoverage: "single-item" as const,
  };
  const two = { ...event("symbols", "correct", now), assessmentCoverage: "single-item" as const };
  assert.equal(objectiveProgress(program(), "symbols", [one, two], now).status, "remediate");
  assert.equal(chooseNextActivity(program(), [one, two], now).kind, "guided-practice");
  assert.equal(chooseNextActivity(program(), [one, two], now).objective?.id, "symbols");
});

test("spaced guided answers cannot establish mastery without delayed recall", () => {
  const first = event("symbols", "correct", now - 2 * 86_400_000);
  const second = event("symbols", "correct", now);
  assert.equal(objectiveProgress(program(), "symbols", [first, second], now).status, "provisional");
  assert.equal(objectiveProgress(program(), "symbols", [first,
    { ...second, taskKind: "recall", rubricResults: [] }], now).status, "remediate");
  assert.equal(objectiveProgress(program(), "symbols", [first,
    { ...second, taskKind: "recall" }], now).status, "mastered");
});
 
test("v3 evidence with spoofed criterion ID or hint level cannot establish mastery", () => {
  const earlier = event("symbols", "correct", now - 2 * 86_400_000);
  const recalled = { ...event("symbols", "correct", now),
    taskKind: "recall" as const, objectiveRevision: 1,
    assistance: { highestHintLevel: 0 as const, independent: true },
    rubricResults: [{ criterion: "Use notation correctly", criterionId: "wrong-id",
      met: true, evidence: "Looks plausible" }],
  };
  assert.equal(objectiveProgress(program(), "symbols", [earlier, recalled], now).status, "remediate");
  const corrected = { ...recalled, rubricResults: [{ ...recalled.rubricResults[0], criterionId: "c1" }] };
  assert.equal(objectiveProgress(program(), "symbols", [earlier, corrected], now).status, "mastered");
  const assisted = { ...corrected, assistance:
    { highestHintLevel: 1 as const, independent: false } };
  assert.equal(objectiveProgress(program(), "symbols", [earlier, assisted], now).status, "remediate");
});
 
test("stable criterion identifiers survive permitted rewording and reject duplicate identities", () => {
  const initial = validateCurriculum(goal, constraints);
  const first = initial.objectives[0];
  assert.deepEqual(first.criteria, [{
    id: "c1", description: "Use notation correctly", required: true,
  }]);
  const revised = structuredClone(initial);
  revised.objectives[0].rubric = ["Use precise notation"];
  revised.objectives[0].criteria![0].description = "Use precise notation";
  assert.equal(validateCurriculum(revised, constraints).objectives[0].criteria?.[0].id, "c1");
  revised.objectives[0].rubric = ["Use precise notation", "Explain units"];
  revised.objectives[0].criteria!.push({ id: "c1", description: "Explain units", required: true });
  assert.throws(() => validateCurriculum(revised, constraints), /Invalid stable criterion identities/);
});


test("rewording preserves mastered stable-ID evidence, but legacy text and replaced IDs do not", () => {
  const original = program();
  const earlier = { ...event("symbols", "correct", now - 2 * 86_400_000),
    objectiveRevision: 1, rubricResults: [{ criterion: "Use notation correctly",
      criterionId: "c1", met: true, evidence: "Worked example" }] };
  const recall = { ...earlier, id: "later", createdAt: now, taskKind: "recall" as const };
  const revised = structuredClone(original);
  revised.planVersion = 2;
  revised.objectives[0].rubric = ["Use precise notation"];
  revised.objectives[0].criteria![0].description = "Use precise notation";
  assert.equal(objectiveProgress(revised, "symbols", [earlier, recall], now).status, "mastered");
  const legacy = [{ ...earlier, objectiveRevision: undefined, rubricResults: [{
    criterion: "Use notation correctly", met: true, evidence: "Legacy work",
  }] }, { ...recall, objectiveRevision: undefined, rubricResults: [{
    criterion: "Use notation correctly", met: true, evidence: "Legacy recall",
  }] }];
  assert.equal(objectiveProgress(revised, "symbols", legacy, now).status, "remediate");
  revised.objectives[0].criteria![0].id = "new-skill";
  assert.equal(objectiveProgress(revised, "symbols", [earlier, recall], now).status, "remediate");
  revised.objectives[0].criteria![0].id = "c1";
  const future = { ...recall, objectiveRevision: 3 };
  assert.equal(objectiveProgress(revised, "symbols", [earlier, future], now).status, "remediate");
});
