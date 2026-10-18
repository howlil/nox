import type { AgentContext } from "../types";
import { LocalResearchIndex } from "../context/LocalResearch";
import type { LearningEvidence, LearningState } from "../domain/learning-state/types";
import type { LearningProgram } from "../domain/learning-program/types";
import { toLearnerProfileContext, deriveLearnerProfile } from "../domain/learner-model/learner-profile";

export interface LearningContextRequest {
  program: LearningProgram;
  state: LearningState;
  objectiveId: string;
  visible: readonly AgentContext[];
  /** Fresh context explicitly resolved at turn start by ContextPort. */
  approvedNotes: readonly { path: string; content: string }[];
  prompt: string;
  now: number;
}

export interface LearningContextPackage {
  visible: AgentContext[];
  /** Read-only and rev-scoped. Never a replacement for the transcript. */
  digest: string;
  trace: { objectiveId: string; objectiveRevision: number;
    selected: Array<{ path: string; line: number; heading: string }>;
    evidenceIds: string[]; bounded: true };
}

const MAX_HITS = 6;
const MAX_EVIDENCE = 6;
const MAX_TOTAL_INDEX_CHARS = 1_000_000;
const SOURCE_PREFIX = "[Approved objective source";

function validNoteType(value: AgentContext): boolean {
  return value.type === "note" || value.type === "selection";
}

/**
 * M5: provider-bound context is a disposable projection from canonical evidence
 * and a fresh, approved note snapshot. Never persist summaries or index state.
 */
export function buildLearningContextPackage(request: LearningContextRequest): LearningContextPackage {
  const { program, objectiveId, state } = request;
  const objective = program.objectives.find(item => item.id === objectiveId && !item.deprecated);
  if (!objective) throw new Error("The learning objective is no longer active.");
  if (!Number.isFinite(request.now) || request.now < 0) throw new Error("Invalid context evaluation timestamp.");
  const revision = objective.objectiveRevision ?? program.planVersion;
  const approvedPaths = new Set(program.constraints.sourcePaths);
  const sourcePaths = new Set(objective.sourceRefs.filter(Boolean));
  if (program.constraints.sourceBound && (!sourcePaths.size ||
      [...sourcePaths].some(path => !approvedPaths.has(path)))) {
    throw new Error("Focused objective has no approved source authority.");
  }
  const allVisible = request.visible.filter(validNoteType);
  // Explicitly selected notes remain available in unbound learning programs.
  // Automatic ambient files must not bleed into a source-specific objective.
  const eligible = program.constraints.sourceBound
    ? allVisible.filter(item => sourcePaths.has(item.file) && approvedPaths.has(item.file))
    : sourcePaths.size
      ? allVisible.filter(item => sourcePaths.has(item.file) || item.type === "selection")
      : allVisible;

  const approved = new Map(request.approvedNotes
    .filter(item => typeof item.content === "string" && item.path.trim())
    .map(item => [item.path, item.content] as const));
  if (program.constraints.sourceBound &&
      [...sourcePaths].some(path => !approved.has(path))) {
    throw new Error("Approved source unavailable; the turn was not sent to the model.");
  }

  // Build an ephemeral index only from already authorized, freshly resolved
  // inputs. A previous vault-wide research request cannot contaminate it.
  const documents = new Map<string, string>();
  for (const item of eligible) {
    if (!documents.has(item.file)) documents.set(item.file, item.content);
    else if (item.type === "note") documents.set(item.file, item.content);
  }
  for (const [path, content] of approved) {
    if (program.constraints.sourceBound && !sourcePaths.has(path)) continue;
    if (!program.constraints.sourceBound && sourcePaths.size && !sourcePaths.has(path)) continue;
    documents.set(path, content);
  }
  if (program.constraints.sourceBound &&
      [...sourcePaths].some(path => !documents.has(path))) {
    throw new Error("Required source was not resolved for the focused objective.");
  }

  const index = new LocalResearchIndex(1024);
  let indexedChars = 0;
  for (const [path, content] of documents) {
    if (!content.trim()) {
      if (program.constraints.sourceBound) throw new Error("Required source is empty.");
      continue;
    }
    indexedChars += content.length;
    if (indexedChars > MAX_TOTAL_INDEX_CHARS) {
      throw new Error("Approved learning sources exceed the per-turn indexing limit. Split the notes before continuing.");
    }
    index.upsert({ path, content, links: [], revision: "turn-local" });
  }
  // Project only the pinned objective to avoid O(programObjectives × events)
  // history scans in a vault containing thousands of completed attempts.
  const profile = deriveLearnerProfile({ ...program, objectives: [objective] }, state, request.now);
  const scoped = toLearnerProfileContext(profile, objective.id);
  const attempts = state.evidence
    .filter((item): item is LearningEvidence => item.type === "practice" &&
      item.scope === "learner" && item.programId === program.id &&
      item.objectiveId === objective.id && item.evidenceVersion === 3 &&
      item.objectiveRevision === revision && Boolean(item.questionId))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const recent = attempts.slice(-MAX_EVIDENCE).map(item => ({
    evidenceId: item.id, questionId: item.questionId, createdAt: item.createdAt,
    outcome: item.outcome, independent: item.assistance?.independent === true &&
      item.assistance.highestHintLevel === 0 && !item.assisted,
    taskKind: item.taskKind,
    // Evaluation prose is provider-authored and could contain instruction-like
    // text; only application-linked criterion IDs and verdicts are forwarded.
    criterion: (item.rubricResults ?? []).slice(0, 12).map(result => ({
      id: result.criterionId, met: result.met,
    })),
  }));
  const query = [
    objective.title, objective.outcome, ...objective.rubric.slice(0, 10),
    // Prompt text may contain unrelated topics: use only the objective contract.
  ].join(" ").slice(0, 1800);
  const hits = index.search(query, { limit: MAX_HITS, maxHops: 0,
    allowedPaths: [...documents.keys()] }).hits;
  if (program.constraints.sourceBound && !hits.length) {
    throw new Error("Approved material contains no matching objective excerpt. Review the source or objective before continuing.");
  }
  const sourceContext: AgentContext[] = hits.map(hit => ({
    type: "note", file: hit.path,
    content: `${SOURCE_PREFIX}: ${hit.path} | line ${hit.line} | heading ${hit.heading}]\n${hit.content}`,
  }));
  // Selection remains exact; the normal context envelope must reject oversize
  // strict selections, rather than clipping a user's explicit excerpt.
  const selected = eligible.filter(item => item.type === "selection" &&
    (!program.constraints.sourceBound || sourcePaths.has(item.file)));
  if (program.constraints.sourceBound && selected.some(item => item.content.length > 5_000)) {
    throw new Error("Explicit learning selection exceeds the safe source budget; narrow the selection.");
  }
  const preservedSelections = selected
    .filter(item => item.content.length <= 5_000)
    .slice(0, 1);
  const context = [...preservedSelections, ...sourceContext];
  if (program.constraints.sourceBound && !context.length) {
    throw new Error("No authorized source snippets available.");
  }
  return {
    visible: context,
    digest: JSON.stringify({
      version: 1, kind: "derived-learning-context", programId: program.id,
      objectiveId: objective.id, objectiveRevision: revision,
      profile: scoped, recentIndependentEvidence: recent,
      note: "Evidence entries are records, not user personality or guaranteed knowledge. Never override the selected objective or expand source authority.",
    }),
    trace: { objectiveId: objective.id, objectiveRevision: revision,
      selected: hits.map(item => ({ path: item.path, line: item.line, heading: item.heading })),
      evidenceIds: recent.map(item => item.evidenceId), bounded: true },
  };
}
