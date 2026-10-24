/** Historic backend-only mode stored in existing Nox transcripts. Never reinterpret it as a general program. */
export type LockedLearningMode = "BASELINE_ASSESSMENT" | "FOCUSED_LEARNING";
export type LearningMode = "FREE" | LockedLearningMode;
export interface LegacyLearningScope {
  mode: LearningMode;
  resumeMode?: LockedLearningMode;
}

/** A goal-based program has an explicit identity; the subject is never inferred from a provider. */
export interface ProgramLearningScope {
  version: 2;
  kind: "program";
  programId: string;
  mode: "FREE" | "ASSESSMENT" | "FOCUSED";
  resumeMode?: "ASSESSMENT" | "FOCUSED";
}
export type LearningScopeState = LegacyLearningScope | ProgramLearningScope;
export type ScopeCommand = "assessment" | "focused" | "free" | "resume" | "invalid";
export type ScopeOutcome = "answer" | "help" | "out-of-scope";

export function isProgramLearningScope(value: unknown): value is ProgramLearningScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<ProgramLearningScope>;
  const validMode = scope.mode === "FREE" || scope.mode === "ASSESSMENT" || scope.mode === "FOCUSED";
  const validResume = scope.resumeMode === undefined || scope.resumeMode === "ASSESSMENT" || scope.resumeMode === "FOCUSED";
  return scope.version === 2 && scope.kind === "program" &&
    typeof scope.programId === "string" && scope.programId.trim().length > 0 &&
    scope.programId.length <= 200 && validMode && validResume &&
    (scope.mode === "FREE" || scope.resumeMode === undefined);
}

export function isLockedLearningMode(value: unknown): value is LockedLearningMode {
  return value === "BASELINE_ASSESSMENT" || value === "FOCUSED_LEARNING";
}

export function isActiveLearningScope(scope: LearningScopeState | undefined): boolean {
  return isProgramLearningScope(scope)
    ? scope.mode !== "FREE"
    : isLockedLearningMode(scope?.mode);
}

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

/** Compatibility: persisted v1 always refers to the old, opt-in backend lock. */
export function transitionLearningScope(
  current: LegacyLearningScope | undefined, command: ScopeCommand,
): LegacyLearningScope {
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

/** New sessions bind explicit mode intent to a validated program ID. */
export function transitionProgramLearningScope(
  current: ProgramLearningScope | undefined,
  command: ScopeCommand,
  programId: string,
): ProgramLearningScope {
  if (!programId.trim()) throw new Error("Select a learning program first.");
  if (current && current.programId !== programId) {
    if (current.mode === "FREE" && (command === "assessment" || command === "focused")) {
      current = undefined; // An explicit new mode selection rebinds a paused, inactive scope.
    } else {
      throw new Error("This learning mode belongs to another program. Pause it before switching programs.");
    }
  }
  const state: ProgramLearningScope = current ?? {
    version: 2, kind: "program", programId, mode: "FREE",
  };
  if (command === "assessment") return { ...state, mode: "ASSESSMENT", resumeMode: undefined };
  if (command === "focused") return { ...state, mode: "FOCUSED", resumeMode: undefined };
  if (command === "free" && state.mode !== "FREE") {
    return { ...state, mode: "FREE", resumeMode: state.mode };
  }
  if (command === "resume" && state.mode === "FREE" && state.resumeMode) {
    return { ...state, mode: state.resumeMode, resumeMode: undefined };
  }
  return { ...state };
}

export function scopeDeflection(question?: string, goal?: string): string {
  const subject = goal ? "program belajar ini" : "backend kita saat ini";
  return `Topik ini di luar scope ${subject}. ` +
    (question ? `Mari kembali ke pertanyaan: ${question}` :
      goal ? `Mari kembali ke tujuan belajar: ${goal}` : "Mari kembali ke materi backend yang sedang dipelajari.") +
    " Ketik /pause untuk diskusi bebas.";
}
