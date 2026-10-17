/** Provider-independent learning program. The learning-state evidence log is authoritative. */
export interface ProgramConstraints {
  deadline?: string; // ISO date, local calendar day
  minutesPerSession: number;
  sessionsPerWeek: number;
  sourcePaths: string[];
  sourceBound: boolean;
  excludedTopics: string[];
  /** Self-reported entry level; never evidence of mastery. */
  startingLevel?: "beginner" | "intermediate" | "advanced";
}
export type SessionPauseReason = "manual" | "ai-running" | "app-inactive" | "recovery" | "idle";

export interface SessionTiming {
  version: 2;
  /** Confirmed learning time, excluding AI execution and explicit pauses. */
  activeMs: number;
  /** Observed time spent waiting for an agent turn. */
  aiWaitingMs: number;
  /** Activity-only attribution. This does not establish mastery. */
  dailyActiveMs?: Record<string, number>;
  focusMaterialPath?: string;
  materialActiveMs?: Record<string, number>;
  /** Optional attribution, only after an explicit objective selection. */
  focusObjectiveId?: string;
  objectiveActiveMs?: Record<string, number>;
  pauseReasons: SessionPauseReason[];
  /** Local wall-clock checkpoint; never used to infer time across restarts. */
  checkpointAt: number;
}

export interface LearningSession {
  startedAt: number;
  timeBudgetMinutes: number;
  /** Missing on historical sessions; migrate without claiming wall-time was active study. */
  timing?: SessionTiming;
}

export interface LearningObjective {
  id: string;
  title: string;
  outcome: string;
  prerequisiteIds: string[];
  estimatedMinutes: number;
  rubric: string[];
  /** Stable within this objective; persist IDs so wording changes do not retarget evidence. */
  criteria?: Array<{ id: string; description: string; required: boolean }>;
  sourceRefs: string[];
  priority: "core" | "supporting" | "optional";
  /** Tombstone: retain historical evidence and objective IDs, but do not schedule it. */
  deprecated?: boolean;
}
export interface CurriculumDraft {
  kind: "curriculum";
  objectives: LearningObjective[];
}
export interface FocusSession {
  id: string;
  programId: string;
  objectiveId: string;
  curriculumRevision: number;
  /** The chat that owns the pending question and its transcript. */
  chatSessionId?: string;
  status: "active" | "paused";
  startedAt: number;
  pausedAt?: number;
}

export interface CurriculumRevisionRecord {
  operationId: string;
  fromVersion: number;
  toVersion: number;
  kind: "prerequisite-remediation" | "revise" | "change-prerequisites" | "deprecate" | "rollback";
  reasonEvidenceIds: string[];
  addedObjectiveId?: string;
  /** Explicit learner-approved structural revisions retain before/after lineage. */
  targetObjectiveId?: string;
  /** A rollback is a new version; the previous operation remains in history. */
  revertedOperationId?: string;
  before?: LearningObjective;
  after?: LearningObjective;
  rationale?: string;
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
  workspaceApproved?: boolean;
  /** v1-compatible optional lock; transcript evidence remains authoritative. */
  focus?: FocusSession;
  /** Evidence-linked structural revisions, not a second source of truth. */
  curriculumRevisions?: CurriculumRevisionRecord[];
  session?: LearningSession;
  sessionHistory?: Array<{ startedAt: number; endedAt: number; minutesSpent: number; activeMinutes?: number; aiWaitingMinutes?: number; objectiveActiveMinutes?: Record<string, number>; dailyActiveMs?: Record<string, number>; materialActiveMinutes?: Record<string, number> }>;
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
  /** Explicit evidence provenance for adaptive decisions. */
  sourceEvidenceIds?: string[];
  targetCriterionIds?: string[];
  scaffoldLevel?: 1 | 2 | 3 | 4;
  dueAt?: number;
  minutesRemaining?: number;
}
