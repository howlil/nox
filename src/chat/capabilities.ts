import type { IconName } from "obsidian";
import type { LearningActionKind } from "../application/learning-types";

export interface NoxCapability {
  action: Exclude<LearningActionKind, "ask">;
  title: string;
  command: string;
  description: string;
  meta: string;
  icon: IconName;
  tone: "purple" | "blue" | "coral" | "green";
}

export const NOX_CAPABILITIES: readonly NoxCapability[] = [
  {
    action: "explain",
    title: "Explain",
    command: "/explain",
    description: "Break down a concept and its relationships.",
    meta: "Understanding",
    icon: "circle-help",
    tone: "purple",
  },
  {
    action: "practice",
    title: "Practice",
    command: "/practice",
    description: "Test understanding with active recall.",
    meta: "Recall",
    icon: "list-checks",
    tone: "blue",
  },
  {
    action: "review",
    title: "Review",
    command: "/review",
    description: "Find missing links and weak explanations.",
    meta: "Gaps",
    icon: "search",
    tone: "coral",
  },
  {
    action: "edit",
    title: "Improve note",
    command: "/edit",
    description: "Propose a safe change to the active note.",
    meta: "Safe edit",
    icon: "pencil",
    tone: "green",
  },
];
