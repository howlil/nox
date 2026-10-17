import type { FocusSession, LearningProgram } from "./types";

export type FocusIntent =
  | { kind: "start"; objectiveId: string }
  | { kind: "continue" | "submit-answer" | "request-hint"; chatSessionId: string; objectiveId?: string }
  | { kind: "pause" | "resume" | "end" | "inspect" }
  | { kind: "unrelated" };

export type FocusAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "focus-active" | "focus-paused" | "wrong-chat" | "wrong-objective" };

export function authorizeFocusIntent(focus: FocusSession | undefined, intent: FocusIntent): FocusAuthorization {
  const allowed: FocusAuthorization = { allowed: true };
  if (!focus) return intent.kind === "resume" || intent.kind === "pause" || intent.kind === "end"
    ? { allowed: false, reason: "focus-paused" } : allowed;
  if (intent.kind === "inspect" || intent.kind === "end") return allowed;
  if (intent.kind === "pause") return focus.status === "active"
    ? allowed : { allowed: false, reason: "focus-paused" };
  if (intent.kind === "resume") return focus.status === "paused"
    ? allowed : { allowed: false, reason: "focus-active" };
  if (focus.status === "paused") return { allowed: false, reason: "focus-paused" };
  if (!("chatSessionId" in intent)) {
    return { allowed: false, reason: "focus-active" };
  }
  if (focus.chatSessionId !== intent.chatSessionId) return { allowed: false, reason: "wrong-chat" };
  if (intent.objectiveId && focus.objectiveId !== intent.objectiveId) {
    return { allowed: false, reason: "wrong-objective" };
  }
  return allowed;
}

export function startObjectiveFocus(
  program: LearningProgram, objectiveId: string, chatSessionId: string, now: number, id: string,
): LearningProgram {
  if (program.focus) throw new Error("End the existing objective focus before starting another.");
  if (!program.objectives.some(o => o.id === objectiveId && !o.deprecated)) {
    throw new Error("Unknown or deprecated objective ID.");
  }
  if (!chatSessionId.trim() || !id.trim() || !Number.isFinite(now) || now < 0) {
    throw new Error("Invalid focus identity.");
  }
  return { ...program, focus: { id, programId: program.id, objectiveId,
    curriculumRevision: program.planVersion, chatSessionId, status: "active", startedAt: now } };
}

export function transitionObjectiveFocus(
  program: LearningProgram, action: "pause" | "resume" | "end", now: number,
): LearningProgram {
  const focus = program.focus;
  if (!focus) throw new Error("No objective focus exists.");
  if (action === "end") return { ...program, focus: undefined };
  if (action === "pause") return focus.status === "paused" ? program :
    { ...program, focus: { ...focus, status: "paused", pausedAt: now } };
  if (focus.status === "active") return program;
  if (focus.curriculumRevision !== program.planVersion ||
      !program.objectives.some(o => o.id === focus.objectiveId)) {
    throw new Error("The focused curriculum changed. End the focus before choosing a new objective.");
  }
  return { ...program, focus: { ...focus, status: "active", pausedAt: undefined } };
}

export function validateObjectiveFocus(program: LearningProgram, focus: FocusSession): void {
  if (!focus || typeof focus.id !== "string" || !focus.id.trim() ||
      typeof focus.chatSessionId !== "string" || !focus.chatSessionId.trim() ||
      focus.programId !== program.id || !program.objectives.some(o => o.id === focus.objectiveId) ||
      focus.curriculumRevision !== program.planVersion ||
      (focus.status !== "active" && focus.status !== "paused") ||
      !Number.isFinite(focus.startedAt) || focus.startedAt < 0 ||
      (focus.pausedAt !== undefined && (!Number.isFinite(focus.pausedAt) ||
        focus.pausedAt < focus.startedAt))) {
    throw new Error("Invalid persisted objective focus.");
  }
}
