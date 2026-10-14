export interface CriterionResult {
  criterion: string;
  met: boolean;
  evidence: string;
}

export function coversCriteria(
  expected: string[],
  actual: CriterionResult[] | undefined,
  outcome: "correct" | "partial" | "incorrect",
): boolean {
  if (!actual || !expected.length || actual.length !== expected.length) return false;
  const requirements = new Set(expected);
  if (requirements.size !== expected.length) return false;
  const keys = new Set(actual.map(item => item.criterion));
  if (keys.size !== expected.length || [...keys].some(key => !requirements.has(key))) return false;
  const all = actual.every(item => item.met);
  return outcome === "correct" ? all : !all;
}
