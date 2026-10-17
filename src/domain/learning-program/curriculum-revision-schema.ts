import type { CurriculumOperation } from "./curriculum-revision";
import type { LearningObjective } from "./types";

/** Decode only an allowlisted proposal. IDs, reason and version come from the application. */
export function decodeCurriculumOperations(raw: unknown): CurriculumOperation[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid curriculum proposal.");
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== "curriculum-revision" || !Array.isArray(obj.operations) ||
      obj.operations.length < 1 || obj.operations.length > 30) {
    throw new Error("Expected 1–30 structural curriculum operations.");
  }
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v && typeof v === "object" && !Array.isArray(v));
  const list = (v: unknown): v is string[] => Array.isArray(v) &&
    v.length <= 60 && v.every(s => typeof s === "string" && s.length > 0 && s.length <= 250);
  const validId = (v: unknown): v is string => typeof v === "string" &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v);
  const objectiveKeys = ["id", "title", "outcome", "prerequisiteIds", "estimatedMinutes",
    "rubric", "sourceRefs", "priority", "requiresTransfer"];
  const changeKeys = objectiveKeys.filter(k => k !== "id" && k !== "prerequisiteIds");
  function allowOnly(item: Record<string, unknown>, allowed: string[]): void {
    if (Object.keys(item).some(k => !allowed.includes(k))) {
      throw new Error("Curriculum proposal attempted to set an unauthorized field.");
    }
  }
  return obj.operations.map((value: unknown) => {
    if (!isRecord(value)) throw new Error("Malformed curriculum operation.");
    if (value.kind === "add") {
      allowOnly(value, ["kind", "objective"]);
      if (!isRecord(value.objective)) throw new Error("Missing new objective.");
      const o = value.objective;
      allowOnly(o, objectiveKeys);
      if (!validId(o.id) || typeof o.title !== "string" || typeof o.outcome !== "string" ||
          !list(o.prerequisiteIds) || !list(o.rubric) || !list(o.sourceRefs) ||
          !Number.isInteger(o.estimatedMinutes) || !["core", "supporting", "optional"].includes(String(o.priority)) ||
          (o.requiresTransfer !== undefined && typeof o.requiresTransfer !== "boolean")) {
        throw new Error("Malformed added objective.");
      }
      return { kind: "add", objective: structuredClone(o) as unknown as LearningObjective };
    }
    if (!validId(value.objectiveId)) throw new Error("Invalid objective ID in revision.");
    if (value.kind === "revise") {
      allowOnly(value, ["kind", "objectiveId", "changes"]);
      if (!isRecord(value.changes) || Object.keys(value.changes).length === 0) {
        throw new Error("Revision changes cannot be empty.");
      }
      allowOnly(value.changes, changeKeys);
      return { kind: "revise", objectiveId: value.objectiveId,
        changes: structuredClone(value.changes) as Extract<CurriculumOperation, { kind: "revise" }>["changes"] };
    }
    if (value.kind === "change-prerequisites") {
      allowOnly(value, ["kind", "objectiveId", "prerequisiteIds"]);
      if (!list(value.prerequisiteIds) || !value.prerequisiteIds.every(validId)) {
        throw new Error("Invalid prerequisite changes.");
      }
      return { kind: "change-prerequisites", objectiveId: value.objectiveId,
        prerequisiteIds: [...value.prerequisiteIds] };
    }
    if (value.kind === "deprecate") {
      allowOnly(value, ["kind", "objectiveId", "replacementIds"]);
      if (!list(value.replacementIds) || !value.replacementIds.every(validId)) {
        throw new Error("Invalid deprecation replacements.");
      }
      return { kind: "deprecate", objectiveId: value.objectiveId,
        replacementIds: [...value.replacementIds] };
    }
    throw new Error("Unsupported curriculum operation.");
  });
}
