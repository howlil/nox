// Backwards-compatible path for existing Obsidian adapters and callers.
// Both old and portable imports resolve to the same error constructors.
export { PersistenceError, LearningStateWriteConflict } from "@nox/core";
