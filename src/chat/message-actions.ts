import { Notice } from "obsidian";
import { createNoxIconButton, setNoxIcon } from "./primitives";

/** Presentation-only actions; the view owns permissions and session changes. */
export function appendMessageActions(parent: HTMLElement, options: {
  text: string;
  messageId?: string;
  onFork?: (messageId: string) => Promise<void>;
  className?: string;
}): HTMLElement {
  const actions = parent.createDiv({ cls: options.className ?? "nox-message-actions" });
  const copy = createNoxIconButton(actions, {
    cls: "nox-message-action", icon: "copy", label: "Copy message", title: "Copy message",
  });
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(options.text).then(() => {
      setNoxIcon(copy, "check");
      copy.setAttribute("aria-label", "Copied");
      window.setTimeout(() => {
        if (!copy.isConnected) return;
        setNoxIcon(copy, "copy");
        copy.setAttribute("aria-label", "Copy message");
      }, 1200);
    }).catch(() => new Notice("Could not copy this message."));
  });
  if (options.messageId && options.onFork) {
    const fork = createNoxIconButton(actions, {
      cls: "nox-message-action", icon: "git-branch",
      label: "Fork conversation from this message", title: "Fork conversation",
    });
    fork.addEventListener("click", () => {
      if (fork.disabled) return;
      void options.onFork!(options.messageId!).catch(error =>
        new Notice(error instanceof Error ? error.message : "Could not fork conversation."));
    });
  }
  return actions;
}
