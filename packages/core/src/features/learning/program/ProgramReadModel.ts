import type { LearningProgram, ProgramCollection } from "../../../domain/learning-program/types";

/**
 * Pure read model for turn admission: both active-program identity and global
 * focus come from one identical authoritative collection snapshot.
 * Never persists, caches, or authorizes an operation by itself.
 */
export function projectProgramFocus(collection: ProgramCollection): {
  current: LearningProgram | null;
  globalFocus: { program: LearningProgram; focus: NonNullable<LearningProgram["focus"]> } | null;
} {
  const current = collection.programs.find(item => item.id === collection.activeProgramId) ?? null;
  const active = collection.programs.find(item => item.focus?.status === "active");
  return { current, globalFocus: active?.focus ? { program: active, focus: active.focus } : null };
}
