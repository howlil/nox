import type { LearningEvidence } from "../learning-state/types";
import type { LearningProgram } from "./types";
import { objectiveProgress } from "./rules";
import { projectedTiming } from "./session-time";

export interface RemainingWorkEstimate {
  minutes: number;
  basis: "initial" | "calibrated";
  samples: number;
  adjustment: number;
}

/** Conservative personalization: timing estimates never establish mastery. */
export function estimateRemainingWork(
  program: LearningProgram,
  evidence: LearningEvidence[],
  now = Date.now(),
): RemainingWorkEstimate {
  const measured = new Map<string, number>();
  for (const session of program.sessionHistory ?? []) {
    for (const [id, minutes] of Object.entries(session.objectiveActiveMinutes ?? {})) {
      measured.set(id, (measured.get(id) ?? 0) + minutes);
    }
  }
  if (program.session) {
    const timing = projectedTiming(program.session, now);
    for (const [id, ms] of Object.entries(timing?.objectiveActiveMs ?? {})) {
      measured.set(id, (measured.get(id) ?? 0) + ms / 60_000);
    }
  }

  const mandatory = program.objectives.filter(o => o.priority !== "optional");
  const completed = mandatory.filter(o => objectiveProgress(program, o.id, evidence, now).status === "mastered");
  const ratios = completed.flatMap(o => {
    const actual = measured.get(o.id) ?? 0;
    return actual >= 5 && o.estimatedMinutes > 0
      ? [Math.max(0.5, Math.min(2.5, actual / o.estimatedMinutes))] : [];
  }).sort((a, b) => a - b);
  const basis: RemainingWorkEstimate["basis"] = ratios.length >= 3 ? "calibrated" : "initial";
  const mid = Math.floor(ratios.length / 2);
  const adjustment = basis === "calibrated"
    ? ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2
    : 1;
  const remaining = mandatory.filter(o => !completed.some(done => done.id === o.id))
    .reduce((sum, o) => sum + o.estimatedMinutes, 0);
  return {
    minutes: Math.ceil(remaining * 1.4 * adjustment),
    basis, samples: ratios.length, adjustment,
  };
}
