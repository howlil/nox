import type { KnowledgeGap, LearningEvidence } from "./types";

const RECALL_SEPARATION_MS = 12 * 60 * 60 * 1000;

function independent(item: LearningEvidence): boolean {
  return item.assistance?.independent === true ||
    (item.assistance === undefined && item.assisted === false);
}

/** Legacy free-form misconceptions are not silently mapped onto unrelated rubric criteria. */
export function deriveGapStatus(
  gap: KnowledgeGap,
  evidence: readonly LearningEvidence[],
): "open" | "improving" | "resolved" {
  if (!gap.criterionId || !gap.programId || !gap.objectiveId) return gap.status;
  const relevant = evidence.filter(item =>
    item.type === "practice" && item.scope === "learner" &&
    item.programId === gap.programId && item.objectiveId === gap.objectiveId &&
    item.rubricResults?.some(result => result.criterionId === gap.criterionId))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const last = relevant.at(-1);
  if (!last) return "open";
  const result = last.rubricResults!.find(item => item.criterionId === gap.criterionId)!;
  if (!result.met) return "open";
  const passing = relevant.filter(item => item.assessmentCoverage !== "single-item" &&
    independent(item) && item.rubricResults?.some(x => x.criterionId === gap.criterionId && x.met));
  if (!passing.length) return "improving";
  // A resolved gap needs independent remediation followed by delayed independent retrieval.
  const first = passing[0];
  const hasRecall = passing.some(item => item.id !== first.id && item.taskKind === "recall" &&
    item.createdAt - first.createdAt >= RECALL_SEPARATION_MS);
  return hasRecall ? "resolved" : "improving";
}
