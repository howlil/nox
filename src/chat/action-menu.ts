import type { IconName } from "obsidian";
import { NOX_CAPABILITIES } from "./capabilities";

export interface ActionMenuContext {
  activeProgramId?: string;
  hasActiveSession: boolean;
  savedProgramCount: number;
  hasPracticeQuestion: boolean;
  legacyMode: "free" | "locked" | "paused";
}

export type MenuDestination =
  | { type: "learning"; kind: "explain" | "practice" | "review" | "edit" }
  | { type: "scope"; command: string }
  | { type: "programs" };

export interface ActionMenuEntry {
  key: string;
  name: string;
  description: string;
  icon: IconName;
  command?: string;
  keywords?: string[];
  action: MenuDestination;
}

type Visibility = (context: ActionMenuContext) => boolean;
const noQuestion: Visibility = context => !context.hasPracticeQuestion;
const hasProgram: Visibility = context => Boolean(context.activeProgramId);
const hasSession: Visibility = context => hasProgram(context) && context.hasActiveSession;
const hasNoSession: Visibility = context => hasProgram(context) && !context.hasActiveSession && !context.hasPracticeQuestion;
const hasQuestion: Visibility = context => context.hasPracticeQuestion;
const hasSavedPrograms: Visibility = context => context.savedProgramCount > 0 && !context.hasPracticeQuestion;
const locked: Visibility = context => context.legacyMode === "locked";
const paused: Visibility = context => context.legacyMode === "paused";

interface AdvancedEntry extends ActionMenuEntry {
  visible: Visibility;
}

const advanced: AdvancedEntry[] = [
  { key: "free-practice", name: "Free practice", description: "Practice outside your learning plan",
    icon: "pencil-line", command: "/free-practice", action: { type: "scope", command: "/free-practice" },
    keywords: ["independent", "quiz"], visible: noQuestion },
  { key: "plan", name: "Create a learning plan", description: "Set a new goal and time budget",
    icon: "route", command: "/plan ", action: { type: "scope", command: "/plan " },
    keywords: ["curriculum", "goal", "create"], visible: noQuestion },
  { key: "next", name: "Continue learning", description: "Your next scheduled activity",
    icon: "play", command: "/next", action: { type: "scope", command: "/next" },
    keywords: ["next", "study", "learn"], visible: hasSession },
  { key: "start-session", name: "Start learning", description: "Begin a timeboxed study session",
    icon: "play-circle", command: "/start-session", action: { type: "scope", command: "/start-session" },
    keywords: ["timebox", "session"], visible: hasNoSession },
  { key: "end-session", name: "End session", description: "Finish this timebox and save study time",
    icon: "square", command: "/end-session", action: { type: "scope", command: "/end-session" },
    keywords: ["stop", "session"], visible: hasSession },
  { key: "extend-session", name: "Extend session", description: "Add 15 minutes to this session",
    icon: "clock-plus", command: "/extend-session 15", action: { type: "scope", command: "/extend-session 15" },
    keywords: ["timebox", "more time"], visible: hasSession },
  { key: "hint", name: "Get a hint", description: "Reveal help for the current question",
    icon: "lightbulb", command: "/hint", action: { type: "scope", command: "/hint" },
    keywords: ["help", "clue"], visible: hasQuestion },
  { key: "progress", name: "Learning progress", description: "Review mastery and upcoming objectives",
    icon: "chart-no-axes-column", command: "/progress", action: { type: "scope", command: "/progress" },
    keywords: ["status", "stats", "learning"], visible: hasProgram },
  { key: "review-due", name: "Due reviews", description: "Show scheduled recall activities",
    icon: "calendar-check", command: "/review-due", action: { type: "scope", command: "/review-due" },
    keywords: ["recall", "spaced repetition"], visible: hasProgram },
  { key: "programs", name: "Learning programs", description: "Browse and switch your saved plans",
    icon: "library", command: "/programs", action: { type: "programs" },
    keywords: ["switch", "saved", "curriculum", "program"], visible: hasSavedPrograms },
  { key: "pause", name: "Pause backend mode", description: "Return to free chat temporarily",
    icon: "pause", command: "/pause", action: { type: "scope", command: "/pause" },
    keywords: ["legacy", "mode"], visible: locked },
  { key: "resume", name: "Resume backend mode", description: "Continue your paused backend question",
    icon: "play", command: "/resume", action: { type: "scope", command: "/resume" },
    keywords: ["legacy", "mode"], visible: paused },
];

/** Stable overview is intentionally short. Search reveals eligible advanced commands. */
/** Prefer one clear next action; retain old slash commands at the controller boundary. */
export function getPrimaryAction(context: ActionMenuContext): ActionMenuEntry {
  const key = context.hasPracticeQuestion ? "hint"
    : context.legacyMode === "locked" ? "pause"
    : context.legacyMode === "paused" ? "resume"
    : hasSession(context) ? "next"
    : hasProgram(context) ? "start-session"
    : "plan";
  return advanced.find(item => item.key === key)!;
}

function scoreAction(item: ActionMenuEntry, query: string): number | null {
  const command = item.command?.trim().replace(/^\\//, "").toLowerCase() ?? "";
  const name = item.name.toLowerCase();
  if (command.startsWith(query) || name.startsWith(query)) return 0;

  // A single character must not match arbitrary text like "s" in "session".
  if (query.length < 2) return null;
  if (name.split(/\\s+/).some(word => word.startsWith(query))) return 1;

  // Keywords are intentional synonyms, never broad matches in descriptions.
  if (query.length >= 3 && item.keywords?.some(word =>
    word.toLowerCase().split(/\\s+/).some(part => part.startsWith(query)))) return 2;
  if (query.length >= 3 && (command.includes(query) || name.includes(query))) return 3;
  return null;
}

/** Compact defaults. Search is a command palette, never a fuzzy description index. */
export function buildActionMenu(context: ActionMenuContext, rawQuery = ""): ActionMenuEntry[] {
  const query = rawQuery.trim().replace(/^\\//, "").toLowerCase();
  const capabilities: ActionMenuEntry[] = NOX_CAPABILITIES.map(item => ({
    key: item.action, name: item.title, description: item.description,
    icon: item.icon, command: item.command,
    action: { type: "learning", kind: item.action },
    keywords: [item.meta],
  }));
  const visibleCapabilities = context.legacyMode === "locked"
    ? capabilities.filter(item => item.key === "practice")
    : capabilities;
  const primary = getPrimaryAction(context);
  const programNav = advanced.find(item => item.key === "programs")!;
  if (!query) {
    return [primary, ...visibleCapabilities,
      ...(hasSavedPrograms(context) && context.legacyMode !== "locked" ? [programNav] : [])];
  }

  const allowedAdvanced = advanced.filter(item =>
    item.visible(context) && (context.legacyMode !== "locked" ||
      ["pause", "hint"].includes(item.key)));
  return [...visibleCapabilities, ...allowedAdvanced]
    .map((item, order) => ({ item, order, score: scoreAction(item, query) }))
    .filter((entry): entry is { item: ActionMenuEntry; order: number; score: number } =>
      entry.score !== null)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, 8)
    .map(({ item }) => item);
}
