import {
  KnowledgeGap,
  LearningEvidence,
  LearningState,
} from "../domain/learning-state/types";
import { isRubricResults } from "../domain/practice/types";

interface LearningEvidenceV1 {
  id: string;
  type: "practice" | "review" | "project";
  concept: string;
  source: string;
  outcome?: string;
  createdAt: number;
}

interface LearningStateV1 {
  version: 1;
  target: string | null;
  currentTopic?: string;
  gaps: KnowledgeGap[];
  evidence: LearningEvidenceV1[];
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  );
}

function isKnowledgeGap(value: unknown): value is KnowledgeGap {
  if (!value || typeof value !== "object") return false;
  const gap = value as Record<string, unknown>;

  return (
    typeof gap.id === "string" &&
    typeof gap.concept === "string" &&
    typeof gap.reason === "string" &&
    isStringArray(gap.evidenceIds) &&
    (gap.status === "open" ||
      gap.status === "improving" ||
      gap.status === "resolved") &&
    (gap.programId === undefined || typeof gap.programId === "string") &&
    (gap.objectiveId === undefined || typeof gap.objectiveId === "string")
  );
}

function isEvidenceV1(
  value: unknown,
): value is LearningEvidenceV1 {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Record<string, unknown>;

  return (
    typeof evidence.id === "string" &&
    (evidence.type === "practice" ||
      evidence.type === "review" ||
      evidence.type === "project") &&
    typeof evidence.concept === "string" &&
    typeof evidence.source === "string" &&
    (evidence.outcome === undefined ||
      typeof evidence.outcome === "string") &&
    typeof evidence.createdAt === "number"
  );
}

function isEvidenceV2(
  value: unknown,
): value is LearningEvidence {
  if (!isEvidenceV1(value)) return false;

  const scope = (
    value as LearningEvidenceV1 & { scope?: unknown }
  ).scope;

  if (scope !== "learner" && scope !== "material") return false;
  const evidence = value as unknown as Record<string, unknown>;
  return (evidence.assessmentCoverage === undefined || evidence.assessmentCoverage === "single-item") &&
    (evidence.programId === undefined || typeof evidence.programId === "string") &&
    (evidence.objectiveId === undefined || typeof evidence.objectiveId === "string") &&
    (evidence.assisted === undefined || typeof evidence.assisted === "boolean") &&
    (evidence.rubricResults === undefined || isRubricResults(evidence.rubricResults));
}

function isEvidenceV3(value: unknown): value is LearningEvidence {
  if (!isEvidenceV2(value)) return false;
  const item = value as unknown as Record<string, unknown>;
  const assistance = item.assistance;
  return (item.objectiveRevision === undefined ||
      (Number.isSafeInteger(item.objectiveRevision) &&
        typeof item.objectiveRevision === "number" && item.objectiveRevision >= 1)) &&
    (item.questionId === undefined || (typeof item.questionId === "string" && item.questionId.length > 0)) &&
    (item.focusSessionId === undefined ||
      (typeof item.focusSessionId === "string" && item.focusSessionId.length > 0)) &&
    (item.evaluator === undefined ||
      ["deterministic", "llm-review", "verified-execution"].includes(String(item.evaluator))) &&
    (assistance === undefined || (typeof assistance === "object" && assistance !== null &&
      !Array.isArray(assistance) && (() => {
        const a = assistance as Record<string, unknown>;
        return Number.isInteger(a.highestHintLevel) &&
          typeof a.highestHintLevel === "number" && a.highestHintLevel >= 0 &&
          a.highestHintLevel <= 4 && typeof a.independent === "boolean" &&
          a.independent === (a.highestHintLevel === 0);
      })())) &&
    (item.rubricResults === undefined || (Array.isArray(item.rubricResults) &&
      item.rubricResults.every((result: { criterionId?: unknown }) =>
        result.criterionId === undefined ||
          (typeof result.criterionId === "string" && result.criterionId.length > 0))));
}

function isV3(value: unknown): value is LearningState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return state.version === 3 && hasSharedShape(state) &&
    (state.evidence as unknown[]).every(isEvidenceV3);
}

function hasSharedShape(value: Record<string, unknown>): boolean {
  return (
    (value.target === null || typeof value.target === "string") &&
    (value.currentTopic === undefined ||
      typeof value.currentTopic === "string") &&
    Array.isArray(value.gaps) &&
    value.gaps.every(isKnowledgeGap) &&
    Array.isArray(value.evidence)
  );
}

function isV1(value: unknown): value is LearningStateV1 {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;

  return (
    state.version === 1 &&
    hasSharedShape(state) &&
    (state.evidence as unknown[]).every(isEvidenceV1)
  );
}

function isV2(value: unknown): value is LearningState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;

  return (
    state.version === 2 &&
    hasSharedShape(state) &&
    (state.evidence as unknown[]).every(isEvidenceV2)
  );
}

export function migrateLearningStateV1(
  state: LearningStateV1,
): LearningState {
  const evidence: LearningEvidence[] = state.evidence.map(
    (item) => ({
      ...item,
      scope: item.type === "review" ? "material" : "learner",
    }),
  );

  const evidenceById = new Map(
    evidence.map((item) => [item.id, item] as const),
  );

  const gaps = state.gaps.filter((gap) => {
    if (gap.evidenceIds.length === 0) return true;

    const referenced = gap.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter(
        (item): item is LearningEvidence => item !== undefined,
      );

    return !(
      referenced.length === gap.evidenceIds.length &&
      referenced.every((item) => item.scope === "material")
    );
  });

  return {
    version: 3,
    target: state.target,
    currentTopic: state.currentTopic,
    gaps,
    evidence,
  };
}

export function decodeLearningState(
  value: unknown,
): LearningState {
  if (isV3(value) || isV2(value)) {
    return {
      ...value,
      version: 3,
      gaps: value.gaps.map((gap) => ({
        ...gap,
        evidenceIds: [...gap.evidenceIds],
      })),
      evidence: value.evidence.map((item) => ({ ...item })),
    };
  }

  if (isV1(value)) {
    return migrateLearningStateV1(value);
  }

  throw new Error("Learning state has an unsupported shape.");
}
