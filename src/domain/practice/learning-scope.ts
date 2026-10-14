export type LockedLearningMode = "BASELINE_ASSESSMENT" | "FOCUSED_LEARNING";
export type LearningMode = "FREE" | LockedLearningMode;
export interface LearningScopeState {
  mode: LearningMode;
  resumeMode?: LockedLearningMode;
}
export type ScopeCommand = "assessment" | "focused" | "free" | "resume" | "invalid";
export type ScopeOutcome = "answer" | "help" | "out-of-scope";

/** Only a whole, explicit user command can change the session lock. */
export function parseScopeCommand(prompt: string): ScopeCommand | undefined {
  switch (prompt.trim().toLowerCase()) {
    case "/mode assessment": return "assessment";
    case "/mode focused": return "focused";
    case "/pause":
    case "/mode free": return "free";
    case "/resume": return "resume";
    default: return /^\/mode(?:\s|$)/i.test(prompt.trim()) ? "invalid" : undefined;
  }
}

export function transitionLearningScope(
  current: LearningScopeState | undefined, command: ScopeCommand,
): LearningScopeState {
  const state = current ?? { mode: "FREE" };
  if (command === "assessment") return { mode: "BASELINE_ASSESSMENT" };
  if (command === "focused") return { mode: "FOCUSED_LEARNING" };
  if (command === "free" && state.mode !== "FREE") {
    return { mode: "FREE", resumeMode: state.mode };
  }
  if (command === "resume" && state.mode === "FREE" && state.resumeMode) {
    return { mode: state.resumeMode };
  }
  return { ...state };
}

export function isLockedLearningMode(value: unknown): value is LockedLearningMode {
  return value === "BASELINE_ASSESSMENT" || value === "FOCUSED_LEARNING";
}

export function scopeDeflection(question?: string): string {
  return "Topik ini di luar scope backend kita saat ini. " +
    (question ? `Mari kembali ke pertanyaan: ${question}` : "Mari kembali ke materi backend yang sedang dipelajari.") +
    " Ketik /pause untuk diskusi bebas.";
}
