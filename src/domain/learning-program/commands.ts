import type { ProgramConstraints } from "./types";
import type { StructuralRevisionAction } from "./structural-revision";
import { validateConstraints } from "./rules";

export type ProgramCommand =
  | { kind: "plan"; goal: string; constraints: ProgramConstraints }
  | { kind: "next" | "progress" | "start-session" | "pause-session" | "resume-session" | "session-time" | "end-session" | "review-due" | "programs" | "free-practice" }
  | { kind: "use-program"; id: string }
  | { kind: "focus"; objectiveId: string }
  | { kind: "pause-focus" | "resume-focus" | "end-focus" | "replan" | "deferred" }
  | { kind: "defer"; text: string }
  | { kind: "extend-session"; minutes: number }
  | { kind: "curriculum-preview"; action: StructuralRevisionAction; rationale: string }
  | { kind: "curriculum-approve"; operationId: string }
  | { kind: "program-backups" }
  | { kind: "program-restore-preview"; backupPath: string }
  | { kind: "program-restore-approve"; operationId: string };

/** Explicit, human-auditable constraints; never hallucinate settings from a goal. */
export function parseProgramCommand(input: string): ProgramCommand | null {
  const value = input.trim();
  if (/^\/program-backups$/i.test(value)) return { kind: "program-backups" };
  const restorePreview = /^\/program-restore-preview\s+(00-learning-os\/backups\/programs-(?:v1|pre-restore)-[a-f0-9-]{36}\.json)$/i.exec(value);
  if (restorePreview) return { kind: "program-restore-preview", backupPath: restorePreview[1] };
  if (/^\/program-restore-preview(?:\s|$)/i.test(value)) {
    throw new Error("Use /program-restore-preview <path> copied from /program-backups.");
  }
  const restoreApproval = /^\/program-restore-approve\s+([a-f0-9-]{36})$/i.exec(value);
  if (restoreApproval) return { kind: "program-restore-approve", operationId: restoreApproval[1] };
  if (/^\/program-restore-approve(?:\s|$)/i.test(value)) {
    throw new Error("Use /program-restore-approve <operation-id> from the preview.");
  }
  const deferral = /^\/defer\s+([\s\S]+)$/i.exec(value);
  if (deferral) {
    const text = deferral[1].trim();
    if (text.length < 3 || text.length > 500) throw new Error("Deferred note must be 3–500 characters.");
    return { kind: "defer", text };
  }
  if (/^\/defer(?:\s|$)/i.test(value)) throw new Error("Use /defer <off-topic note>.");
  const approval = /^\/curriculum-approve\s+([a-zA-Z0-9:_-]{6,100})$/.exec(value);
  if (approval) return { kind: "curriculum-approve", operationId: approval[1] };
  if (/^\/curriculum-approve(?:\s|$)/i.test(value)) {
    throw new Error("Use /curriculum-approve <operation-id> from the validated preview.");
  }
  const revision = /^\/curriculum-preview\s+([\s\S]+)$/i.exec(value);
  if (revision) {
    let parsed: unknown;
    try { parsed = JSON.parse(revision[1]); }
    catch { throw new Error("Curriculum preview requires a valid JSON action."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Curriculum preview requires a structured action.");
    }
    const p = parsed as Record<string, unknown>;
    if (typeof p.objectiveId !== "string" || typeof p.rationale !== "string" ||
        !["revise", "change-prerequisites", "deprecate", "rollback"].includes(String(p.kind))) {
      throw new Error("Revision needs kind, objectiveId and rationale.");
    }
    if (p.kind === "revise" &&
        (!p.changes || typeof p.changes !== "object" || Array.isArray(p.changes))) {
      throw new Error("Revise requires a changes object.");
    }
    if (p.kind === "change-prerequisites" && !Array.isArray(p.prerequisiteIds)) {
      throw new Error("Prerequisite revision requires an array of objective IDs.");
    }
    if (p.kind === "rollback" &&
        (typeof p.targetOperationId !== "string" ||
          !/^[a-zA-Z0-9:_-]{6,100}$/.test(p.targetOperationId))) {
      throw new Error("Rollback requires a valid prior operation ID.");
    }
    const allowed = p.kind === "revise" ? ["kind", "objectiveId", "rationale", "changes"] :
      p.kind === "change-prerequisites" ? ["kind", "objectiveId", "rationale", "prerequisiteIds"] :
        p.kind === "rollback" ? ["kind", "objectiveId", "rationale", "targetOperationId"] :
        ["kind", "objectiveId", "rationale"];
    if (Object.keys(p).some(key => !allowed.includes(key))) {
      throw new Error("Revision has unsupported properties.");
    }
    const { rationale, ...action } = p;
    return { kind: "curriculum-preview", rationale,
      action: action as unknown as StructuralRevisionAction };
  }
  if (/^\/curriculum-preview(?:\s|$)/i.test(value)) {
    throw new Error('Use /curriculum-preview {"kind":"deprecate","objectiveId":"id","rationale":"Why this is obsolete"}');
  }
  const focus = /^\/focus\s+([a-z0-9][a-z0-9_-]{0,63})$/i.exec(value);
  if (focus) return { kind: "focus", objectiveId: focus[1] };
  if (/^\/focus(?:\s|$)/i.test(value)) throw new Error("Use /focus <objective-id> shown by /progress.");
  const extension = /^\/extend-session\s+(\d+)$/i.exec(value);
  if (extension) return { kind: "extend-session", minutes: Number(extension[1]) };
  if (/^\/extend-session(?:\s|$)/i.test(value)) throw new Error("Use /extend-session <minutes>.");
  const selected = /^\/use-program\s+([a-f0-9-]{36})$/i.exec(value);
  if (selected) return { kind: "use-program", id: selected[1] };
  if (/^\/use-program(?:\s|$)/i.test(value)) throw new Error("Use /use-program <program-id> shown by /programs.");
  const commands: Record<string, ProgramCommand["kind"]> = {
    "/next": "next", "/progress": "progress", "/start-session": "start-session",
    "/pause-session": "pause-session", "/resume-session": "resume-session", "/session-time": "session-time",
    "/end-session": "end-session", "/review-due": "review-due", "/programs": "programs", "/free-practice": "free-practice",
    "/pause-focus": "pause-focus", "/resume-focus": "resume-focus", "/end-focus": "end-focus",
    "/replan": "replan", "/deferred": "deferred",
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
