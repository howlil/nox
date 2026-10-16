import type { FocusSession } from "./types";

/** A pure policy decision; the controller remains the preflight authority. */
export type FocusIntent =
  | { kind: "continue" | "request-hint" | "request-clarification"; chatSessionId: string }
  | { kind: "submit-answer"; chatSessionId: string; programId: string; objectiveId: string }
  | { kind: "switch-program" | "create-program" | "ordinary-chat" }
  | { kind: "pause" | "resume" | "end" | "inspect" };

export type FocusAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "focus-active" | "focus-paused" | "wrong-chat" | "wrong-objective" };

export function authorizeFocusIntent(
  focus: FocusSession | undefined,
  intent: FocusIntent,
): FocusAuthorization {
  const allow: FocusAuthorization = { allowed: true };
  if (!focus) return allow;

  if (intent.kind === "inspect" || intent.kind === "end") return allow;
  if (intent.kind === "pause") {
    return focus.status === "active" ? allow : { allowed: false, reason: "focus-paused" };
  }
  if (intent.kind === "resume") {
    return focus.status === "paused" ? allow : { allowed: false, reason: "focus-active" };
  }
  if (focus.status === "paused") {
    // The paused program can be left without deleting its focus.
    return intent.kind === "switch-program" || intent.kind === "create-program" ||
      intent.kind === "ordinary-chat"
      ? allow
      : { allowed: false, reason: "focus-paused" };
  }
  if (intent.kind === "switch-program" || intent.kind === "create-program" ||
      intent.kind === "ordinary-chat") return { allowed: false, reason: "focus-active" };
  if (focus.chatSessionId && focus.chatSessionId !== intent.chatSessionId) {
    return { allowed: false, reason: "wrong-chat" };
  }
  if (intent.kind === "submit-answer" &&
      (intent.programId !== focus.programId || intent.objectiveId !== focus.objectiveId)) {
    return { allowed: false, reason: "wrong-objective" };
  }
  return allow;
}
