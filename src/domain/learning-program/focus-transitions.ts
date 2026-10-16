import type { FocusSession, LearningProgram } from "./types";

/** Persistent objective-level authorization, independent of chat mode and timers. */
export function startObjectiveFocus(program: LearningProgram, objectiveId: string,
  now: number, id: string, chatSessionId?: string): LearningProgram {
  if (program.focus) throw new Error("Objective focus already exists. End it before choosing another objective.");
  if (!program.objectives.some(item => item.id === objectiveId)) throw new Error("Unknown objective ID.");
  return { ...program, focus: {
    id, programId: program.id, objectiveId, curriculumRevision: program.planVersion,
    chatSessionId, status: "active", startedAt: now,
  } };
}

export function transitionObjectiveFocus(program: LearningProgram,
  command: "pause" | "resume" | "end", now: number): LearningProgram {
  const focus = program.focus;
  if (!focus) throw new Error("No objective focus to change.");
  if (command === "end") return { ...program, focus: undefined };
  if (command === "pause") {
    return focus.status === "paused" ? program : {
      ...program, focus: { ...focus, status: "paused", pausedAt: now },
    };
  }
  if (focus.status === "active") return program;
  if (!program.objectives.some(item => item.id === focus.objectiveId) ||
      focus.curriculumRevision !== program.planVersion) {
    throw new Error("Focused objective changed; review the curriculum before resuming.");
  }
  return { ...program, focus: { ...focus, status: "active", pausedAt: undefined } };
}

export function validateObjectiveFocus(program: LearningProgram, focus: FocusSession): void {
  if (!focus.id || focus.programId !== program.id ||
      !program.objectives.some(item => item.id === focus.objectiveId) ||
      !Number.isInteger(focus.curriculumRevision) ||
      focus.curriculumRevision !== program.planVersion ||
      (focus.status !== "active" && focus.status !== "paused") ||
      (focus.chatSessionId !== undefined &&
        (typeof focus.chatSessionId !== "string" || !focus.chatSessionId.trim())) ||
      !Number.isFinite(focus.startedAt) || focus.startedAt < 0 ||
      (focus.pausedAt !== undefined && (!Number.isFinite(focus.pausedAt) ||
        focus.pausedAt < focus.startedAt))) {
    throw new Error("Invalid persisted objective focus.");
  }
}

/** No model call or chat switch may bypass the global active focus. */
export function allowsFocusedTurn(prompt: string, hasActiveQuestion: boolean): boolean {
  const text = prompt.trim().toLowerCase();
  if (/^\/(?:next|hint|progress|review-due|programs|session-time|pause-focus|end-focus)(?:\s|$)/.test(text)) {
    return true;
  }
  return hasActiveQuestion && text.length > 0 && !text.startsWith("/");
}
