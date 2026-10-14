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
const always: Visibility = () => true;
const hasProgram: Visibility = context => Boolean(context.activeProgramId);
const hasSession: Visibility = context => hasProgram(context) && context.hasActiveSession;
const hasNoSession: Visibility = context => hasProgram(context) && !context.hasActiveSession;
const hasQuestion: Visibility = context => context.hasPracticeQuestion;
const hasSavedPrograms: Visibility = context => context.savedProgramCount > 0;
const locked: Visibility = context => context.legacyMode === "locked";
const paused: Visibility = context => context.legacyMode === "paused";

interface AdvancedEntry extends ActionMenuEntry {
  visible: Visibility;
}

const advanced: AdvancedEntry[] = [
  { key: "free-practice", name: "Free practice", description: "Practice outside your learning plan",
    icon: "pencil-line", command: "/free-practice", action: { type: "scope", command: "/free-practice" },
    keywords: ["independent", "quiz"], visible: always },
  { key: "plan", name: "Create a learning plan", description: "Set a new goal and time budget",
    icon: "route", command: "/plan ", action: { type: "scope", command: "/plan " },
    keywords: ["curriculum", "goal", "create"], visible: always },
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
  { key: "programs-command", name: "List program IDs", description: "Print all saved program IDs in chat",
    icon: "list", command: "/programs", action: { type: "scope", command: "/programs" },
    keywords: ["ids", "programs"], visible: hasSavedPrograms },
  { key: "use-program", name: "Switch program by ID", description: "Use /use-program followed by the saved ID",
    icon: "list-restart", command: "/use-program ", action: { type: "scope", command: "/use-program " },
    keywords: ["change", "select"], visible: hasSavedPrograms },
  { key: "assessment", name: "Backend baseline assessment", description: "Legacy backend-only learning mode",
    icon: "list-checks", command: "/mode assessment", action: { type: "scope", command: "/mode assessment" },
    keywords: ["legacy", "mode", "backend"], visible: always },
  { key: "focused", name: "Backend focused learning", description: "Legacy backend-only focused mode",
    icon: "focus", command: "/mode focused", action: { type: "scope", command: "/mode focused" },
    keywords: ["legacy", "mode", "backend"], visible: always },
  { key: "pause", name: "Pause backend mode", description: "Return to free chat temporarily",
    icon: "pause", command: "/pause", action: { type: "scope", command: "/pause" },
    keywords: ["legacy", "mode"], visible: locked },
  { key: "resume", name: "Resume backend mode", description: "Continue your paused backend question",
    icon: "play", command: "/resume", action: { type: "scope", command: "/resume" },
    keywords: ["legacy", "mode"], visible: paused },
];

/** Stable overview is intentionally short. Search reveals eligible advanced commands. */
export function buildActionMenu(
  context: ActionMenuContext,
  rawQuery = "",
): ActionMenuEntry[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  let primary: ActionMenuEntry;
  if (context.hasPracticeQuestion) {
    primary = { ...advanced.find(item => item.key === "hint")! };
  } else if (context.legacyMode === "locked") {
    primary = { ...advanced.find(item => item.key === "pause")! };
  } else if (context.legacyMode === "paused") {
    primary = { ...advanced.find(item => item.key === "resume")! };
  } else if (hasSession(context)) {
    primary = { ...advanced.find(item => item.key === "next")! };
  } else if (hasProgram(context)) {
    primary = { ...advanced.find(item => item.key === "start-session")! };
  } else {
    primary = { ...advanced.find(item => item.key === "plan")! };
  }

  const capabilities: ActionMenuEntry[] = NOX_CAPABILITIES.map(item => ({
    key: item.action, name: item.title, description: item.description,
    icon: item.icon, command: item.command, action: { type: "learning", kind: item.action },
    keywords: [item.meta, "note"],
  }));
  const programNav = advanced.find(item => item.key === "programs")!;
  const visibleCapabilities = context.legacyMode === "locked"
    ? capabilities.filter(item => item.key === "practice")
    : capabilities;
  const defaults: ActionMenuEntry[] = [primary, ...visibleCapabilities,
    ...(hasSavedPrograms(context) && context.legacyMode !== "locked" ? [programNav] : [])];
  if (!query) return defaults;

  const entries = [...visibleCapabilities, ...advanced.filter(item =>
    item.visible(context) && (context.legacyMode !== "locked" ||
      ["pause", "hint", "assessment", "focused"].includes(item.key)))];
  const unique = new Map<string, ActionMenuEntry>();
  for (const item of entries) unique.set(item.key, item);
  return [...unique.values()]
    .map((item, position) => {
      const name = item.name.toLocaleLowerCase();
      const command = item.command?.toLocaleLowerCase() ?? "";
      const keywords = item.keywords?.join(" ").toLocaleLowerCase() ?? "";
      const description = item.description.toLocaleLowerCase();
      const score = command.replace(/^\//, "").startsWith(query) || name.startsWith(query) ? 0 :
        name.includes(query) || command.includes(query) ? 1 :
        keywords.includes(query) ? 2 : description.includes(query) ? 3 : 99;
      return { item, score, position };
    })
    .filter(row => row.score < 99)
    .sort((a, b) => a.score - b.score || a.position - b.position)
    .slice(0, 8).map(row => row.item);
}
