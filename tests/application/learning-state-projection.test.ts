import assert from "node:assert/strict";
import test from "node:test";
import { toPromptLearningState } from "../../src/application/learning-state-projection";
import type { LearningState } from "../../src/domain/learning-state/types";

test("provider context excludes other programs and material-only review evidence", () => {
  const state: LearningState = { version: 2, target: null, gaps: [{
    id: "g", concept: "Concurrency", reason: "Missed race",
    evidenceIds: [], status: "open", programId: "p", objectiveId: "o",
  }, {
    id: "foreign", concept: "Networking", reason: "Other topic",
    evidenceIds: [], status: "open", programId: "q", objectiveId: "o",
  }], evidence: [{
    id: "a", type: "practice", scope: "learner", programId: "p", objectiveId: "o",
    concept: "Concurrency", source: "challenge", createdAt: 1,
  }, {
    id: "b", type: "practice", scope: "learner", programId: "q", objectiveId: "o",
    concept: "Networking", source: "challenge", createdAt: 2,
  }, {
    id: "c", type: "review", scope: "material",
    concept: "Materials", source: "note.md", createdAt: 3,
  }] };
  const scoped = toPromptLearningState(state, "p");
  assert.deepEqual(scoped.recentEvidence.map(x => x.id), ["a"]);
  assert.deepEqual(scoped.gaps.map(x => x.id), ["g"]);
  assert.equal(toPromptLearningState(state).recentEvidence.length, 3);
});
