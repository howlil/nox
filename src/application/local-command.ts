import { parseProgramCommand } from "../domain/learning-program/commands";
import { parseScopeCommand } from "../domain/practice/learning-scope";

/**
 * Domain policy for commands that do not need inference. The presentation layer
 * may ask the LearningController for this capability but must not parse a
 * business command or decide its execution environment.
 */
export function isLocallyExecutableCommand(input: string): boolean {
  const prompt = input.trim();
  if (prompt.toLowerCase() === "/hint" || parseScopeCommand(prompt)) return true;
  try {
    const command = parseProgramCommand(prompt);
    return Boolean(command && command.kind !== "plan" &&
      command.kind !== "next" && command.kind !== "free-practice");
  } catch {
    return false;
  }
}
