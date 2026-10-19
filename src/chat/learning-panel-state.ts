import type { NoxProgramOverview } from "../application/learning-types";
import type { CurriculumOperation } from "../domain/learning-program/curriculum-revision";

export interface LearningPanelAction { label: string; command: string; destructive?: boolean }
export interface LearningPanelState {
  focus: {
    objectiveId: string; title: string; status: "active" | "paused";
    criteria: Array<{ id: string; title: string; status: string; evidenceIds: string[] }>;
    actions: LearningPanelAction[];
  } | null;
  next: { text: string; objective?: string; dueAt?: number; trigger?: string; criteria: string[] };
  revision: {
    operationId: string; fromVersion: number; toVersion: number; reason: string;
    changes: string[]; evidenceIds: string[];
    actions: LearningPanelAction[];
  } | null;
  mastered: number;
  total: number;
}

function describeOperation(operation: CurriculumOperation): string {
  if (operation.kind === "revert") return "Revert revision: " + operation.targetOperationId;
  if (operation.kind === "add") return "Add: " + operation.objective.title;
  if (operation.kind === "deprecate") return "Deprecate: " + operation.objectiveId;
  if (operation.kind === "change-prerequisites") {
    return "Change prerequisites: " + operation.objectiveId;
  }
  return "Revise: " + operation.objectiveId + " (" +
    Object.keys(operation.changes).sort().join(", ") + ")";
}

/** Deterministic, read-only presentation policy. Commands are explicit user actions. */
export function projectLearningPanel(
  overview: NoxProgramOverview, now: number,
): LearningPanelState {
  const focus = overview.focus
    ? overview.objectives.find(item => item.objective.id === overview.focus?.objectiveId)
    : undefined;
  const focusStatus = overview.focus?.status;
  const focusActions: LearningPanelAction[] = focusStatus === "active" ? [
    { label: "Next activity", command: "/next" },
    { label: "Pause", command: "/pause-focus" },
    { label: "End focus", command: "/end-focus", destructive: true },
  ] : focusStatus === "paused" ? [
    { label: "Resume focus", command: "/resume-focus" },
    { label: "End focus", command: "/end-focus", destructive: true },
  ] : [];
  const revision = overview.revisionPreview;
  const eligibleRevision = revision &&
    !overview.focus && !overview.active &&
    revision.fromVersion === overview.planVersion &&
    now <= revision.expiresAt &&
    revision.operations.length > 0;
  return {
    focus: focus && focusStatus ? {
      objectiveId: focus.objective.id, title: focus.objective.title,
      status: focusStatus,
      criteria: focus.criteria.map(c => ({
        id: c.id, title: c.label, status: c.status,
        evidenceIds: c.evidenceIds.slice(-4),
      })), actions: focusActions,
    } : null,
    next: {
      text: overview.next.reason,
      objective: overview.next.objectiveId
        ? overview.objectives.find(o => o.objective.id === overview.next.objectiveId)?.objective.title
        : undefined,
      dueAt: overview.next.dueAt,
      trigger: overview.next.trigger,
      criteria: (overview.next.criterionIds ?? []).slice(0, 12),
    },
    revision: eligibleRevision ? {
      operationId: revision.operationId, fromVersion: revision.fromVersion,
      toVersion: revision.toVersion, reason: revision.reason,
      changes: revision.operations.map(describeOperation),
      evidenceIds: revision.reasonEvidenceIds.slice(0, 8),
      actions: [
        { label: "Approve changes", command: "/approve-replan " + revision.operationId },
        { label: "Reject", command: "/cancel-replan " + revision.operationId },
      ],
    } : null,
    mastered: overview.objectives.filter(o => o.status === "mastered").length,
    total: overview.objectives.length,
  };
}
