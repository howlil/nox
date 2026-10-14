import type { ProgramConstraints } from "./types";
import { validateConstraints } from "./rules";

export type ProgramCommand =
  | { kind: "plan"; goal: string; constraints: ProgramConstraints }
  | { kind: "next" | "progress" | "start-session" | "end-session" | "review-due" | "programs" | "free-practice" }
  | { kind: "use-program"; id: string }
  | { kind: "extend-session"; minutes: number };

/** Explicit, human-auditable constraints; never hallucinate settings from a goal. */
export function parseProgramCommand(input: string): ProgramCommand | null {
  const value = input.trim();
  const extension = /^\/extend-session\s+(\d+)$/i.exec(value);
  if (extension) return { kind: "extend-session", minutes: Number(extension[1]) };
  if (/^\/extend-session(?:\s|$)/i.test(value)) throw new Error("Use /extend-session <minutes>.");
  const selected = /^\/use-program\s+([a-f0-9-]{36})$/i.exec(value);
  if (selected) return { kind: "use-program", id: selected[1] };
  if (/^\/use-program(?:\s|$)/i.test(value)) throw new Error("Use /use-program <program-id> shown by /programs.");
  const commands: Record<string, ProgramCommand["kind"]> = {
    "/next": "next", "/progress": "progress", "/start-session": "start-session",
    "/end-session": "end-session", "/review-due": "review-due", "/programs": "programs", "/free-practice": "free-practice",
  };
  if (commands[value.toLowerCase()]) return { kind: commands[value.toLowerCase()] } as ProgramCommand;
  if (!/^\/plan(?:\s|$)/i.test(value)) return null;
  const segments = value.slice(5).split("|").map(s => s.trim());
  const goal = segments.shift()?.trim() ?? "";
  if (!goal) throw new Error("Usage: /plan <goal> | deadline=YYYY-MM-DD | minutes=45 | sessions=3 | sources=active");
  const constraints: ProgramConstraints = {
    minutesPerSession: 45, sessionsPerWeek: 3,
    sourcePaths: [], sourceBound: false, excludedTopics: [],
  };
  for (const segment of segments) {
    const idx = segment.indexOf("=");
    if (idx === -1) throw new Error(`Invalid plan option: ${segment}`);
    const key = segment.slice(0, idx).trim().toLowerCase();
    const val = segment.slice(idx + 1).trim();
    if (key === "deadline") constraints.deadline = val;
    else if (key === "minutes") constraints.minutesPerSession = Number(val);
    else if (key === "sessions") constraints.sessionsPerWeek = Number(val);
    else if (key === "sources") {
      if (val !== "active") throw new Error("Use sources=active to restrict the plan to the active note.");
      constraints.sourceBound = true;
    } else if (key === "exclude") constraints.excludedTopics = val.split(",").map(s => s.trim()).filter(Boolean);
    else throw new Error(`Unknown plan option: ${key}`);
  }
  // Source paths are resolved from trusted Obsidian context by the application.
  if (!constraints.sourceBound) validateConstraints(constraints);
  return { kind: "plan", goal, constraints };
}
