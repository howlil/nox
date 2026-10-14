/** Provider-independent learning program. The learning-state evidence log is authoritative. */
export interface ProgramConstraints {
  deadline?: string; // ISO date, local calendar day
  minutesPerSession: number;
  sessionsPerWeek: number;
  sourcePaths: string[];
  sourceBound: boolean;
  excludedTopics: string[];
}
export interface LearningObjective {
  id: string;
  title: string;
  outcome: string;
  prerequisiteIds: string[];
  estimatedMinutes: number;
  rubric: string[];
  sourceRefs: string[];
  priority: "core" | "supporting" | "optional";
}
export interface CurriculumDraft {
  kind: "curriculum";
  objectives: LearningObjective[];
}
export interface LearningProgram {
  version: 1;
  id: string;
  goal: string;
  constraints: ProgramConstraints;
  objectives: LearningObjective[];
  createdAt: number;
  planVersion: number;
  creationOperationId?: string;
  session?: { startedAt: number; timeBudgetMinutes: number; };
  sessionHistory?: Array<{ startedAt: number; endedAt: number; minutesSpent: number }>;
  instructionEvents?: Array<{ objectiveId: string; afterEvidenceAt: number; taughtAt: number }>;
}
export interface ProgramCollection {
  version: 1;
  activeProgramId?: string;
  programs: LearningProgram[];
}
export type ActivityKind = "diagnostic" | "teach" | "guided-practice" | "recall" | "remediate" | "transfer" | "wait" | "timebox-ended";
export interface LearningDecision {
  kind: ActivityKind;
  objective?: LearningObjective;
  reason: string;
  dueAt?: number;
  minutesRemaining?: number;
}
