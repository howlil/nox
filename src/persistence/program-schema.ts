import type { LearningProgram, ProgramCollection } from "../domain/learning-program/types";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** File-format decoder; semantic DAG, source and session checks belong to the store. */
export function decodeProgramCollection(value: unknown): ProgramCollection {
  if (!isObject(value) || (value.version !== 1 && value.version !== 2) ||
      !Array.isArray(value.programs) || value.programs.length > 100 ||
      (value.activeProgramId !== undefined &&
        (typeof value.activeProgramId !== "string" || !value.activeProgramId)) ||
      !value.programs.every((p: unknown) =>
        isObject(p) && p.version === value.version && typeof p.id === "string" &&
        p.id.trim().length > 0)) {
    throw new Error("Unsupported NOX program collection.");
  }
  const ids = new Set<string>();
  for (const item of value.programs as LearningProgram[]) {
    if (ids.has(item.id)) throw new Error("Duplicate learning program identity.");
    ids.add(item.id);
  }
  if (value.activeProgramId !== undefined && !ids.has(value.activeProgramId as string)) {
    throw new Error("Active learning program is missing.");
  }
  return structuredClone(value) as unknown as ProgramCollection;
}

/** Upgrade only schema versions. Never synthesize learner evidence or timestamps. */
export function migrateProgramCollectionV1(value: ProgramCollection): ProgramCollection {
  const validated = decodeProgramCollection(value);
  if (validated.version === 2) return validated;
  return {
    ...validated,
    version: 2,
    programs: validated.programs.map(program => ({ ...program, version: 2 })),
  };
}


/** Validate and normalize application-owned updates, which may contain a new v1
 * draft appended to a loaded v2 collection. Vault reads stay strict: mixed-version
 * persisted JSON is never silently reinterpreted.
 */
export function prepareProgramCollectionWrite(value: ProgramCollection): ProgramCollection {
  if (!isObject(value) || (value.version !== 1 && value.version !== 2) ||
      !Array.isArray(value.programs) ||
      !value.programs.every((p: unknown) =>
        isObject(p) && (p.version === 1 || p.version === 2))) {
    throw new Error("Unsupported NOX program collection.");
  }
  return decodeProgramCollection({
    ...value, version: 2,
    programs: value.programs.map(program => ({ ...program, version: 2 })),
  });
}
