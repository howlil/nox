import type { LearningActionKind, LearningContext } from "@nox/core";
import type { NoxComposerContext } from "./composer";

/** Pure, non-authoritative composer display projection. Never resolves vault access. */
type VisibleContext = Pick<LearningContext, "selection" | "activeNote">;

export function projectComposerPlaceholder(
  action: LearningActionKind,
  context: VisibleContext | null,
  locked: boolean,
): string {
  if (locked) return "Answer or clarify the current question · /pause to leave";
  const hasSelection = Boolean(context?.selection);
  const hasNote = Boolean(context?.activeNote);
  switch (action) {
    case "ask": return hasSelection ? "Ask about this selection..." :
      hasNote ? "Ask about this note..." : "Ask Nox...";
    case "explain": return hasSelection
      ? "What should I explain about this selection?" : "What should I explain?";
    case "practice": return hasSelection
      ? "Practice this selection..." : "What should we practice?";
    case "review": return hasNote
      ? "What should I review in this note?" : "What should I review?";
    case "edit": return hasNote
      ? "How should I improve this note?" : "What should I improve?";
  }
}

/**
 * Review-source precedence is UI-only. The LearningController, not chips,
 * resolves the authorized explicit note on send.
 */
export function projectComposerContextChips(
  context: VisibleContext | null,
  pendingFindingSource: string | null,
  action: LearningActionKind,
  systemContextFiles: readonly string[],
): NoxComposerContext[] {
  const chips: NoxComposerContext[] = [];
  const selection = context?.selection;
  const pinned = pendingFindingSource && (action === "practice" || action === "edit")
    ? pendingFindingSource : null;
  const automaticPath = selection?.file ?? context?.activeNote?.path;

  if (pinned && pinned !== automaticPath) {
    chips.push({
      key: "review-source",
      text: `@${pinned.split("/").pop() ?? pinned}`,
      title: `Pinned review source: ${pinned}`,
      icon: "file-text",
    });
  } else if (selection) {
    chips.push({
      key: "selection", text: "@selection", title: selection.file, icon: "file-text",
    });
  }

  const activeNote = context?.activeNote;
  if (!selection && activeNote && !(pinned && pinned !== automaticPath)) {
    chips.push({
      key: "note",
      text: `@${activeNote.path.split("/").pop() ?? activeNote.path}`,
      title: activeNote.path, icon: "file-text",
    });
  }
  if (systemContextFiles.length > 0) {
    chips.push({
      key: "system",
      text: "@nox-system",
      title: systemContextFiles.join("\n"),
      icon: "file-text",
    });
  }
  return chips;
}
