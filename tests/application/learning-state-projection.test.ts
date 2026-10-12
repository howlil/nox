import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PROMPT_EVIDENCE,
  MAX_PROMPT_GAPS,
  toPromptLearningState,
} from "../../src/application/learning-state-projection";

test("prompt learning state is bounded and excludes resolved gaps", () => {
  const gaps = Array.from({ length: 30 }, (_, index) => ({
    id: `gap-${index}`,
    concept: `concept-${index}`,
    reason: "reason",
    evidenceIds: [],
    status: (index % 3 === 0 ? "resolved" : "open") as
      | "resolved"
      | "open",
  }));

  const evidence = Array.from({ length: 40 }, (_, index) => ({
    id: `e-${index}`,
    type: "practice" as const,
    scope: "learner" as const,
    concept: "indexes",
    source: "note.md",
    createdAt: index,
  }));

  const projected = toPromptLearningState({
    version: 2,
    target: null,
    gaps,
    evidence,
  });

  assert.ok(projected.gaps.length <= MAX_PROMPT_GAPS);
  assert.equal(projected.gaps.some((gap) => gap.status === "resolved"), false);
  assert.equal(projected.recentEvidence.length, MAX_PROMPT_EVIDENCE);
  assert.equal(projected.recentEvidence[0]?.id, "e-20");
});
