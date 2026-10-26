import type { ChatSession, ChatMessage } from "../../../../packages/core/src/types";
import { appendMessageActions } from "../../../chat/message-actions";
import { createNoxIconButton } from "../../../chat/primitives";

export interface ResponseActionCallbacks {
  isBusy(): boolean;
  canRegenerate(): boolean;
  onFork(id: string): Promise<void>;
  onSelectVersion(messageIndex: number, versionIndex: number, sessionId: string): void;
  onRegenerate(messageIndex: number, user: ChatMessage, assistant: ChatMessage): void;
  onQuickCheck(response: string): void;
}

/** Pure transcript toolbar with callback intents; session edits remain app-owned. */
export function renderResponseActions(
  bubble: HTMLElement, responseText: string, messageIndex: number,
  session: ChatSession, hasActiveQuestion: boolean, callbacks: ResponseActionCallbacks,
): void {
  if (!responseText.trim()) return;
  const messages = session.messages;
  const message = messages[messageIndex];
  if (message?.role !== "assistant") return;
  const user = messages[messageIndex - 1];
  const isLatest = messageIndex === messages.length - 1;
  const canRegenerate = isLatest && user?.role === "user" &&
    (user.action === "ask" || user.action === "explain") &&
    !hasActiveQuestion && !message.proposal && !message.parts?.length;
  if (message.id) {
    bubble.dataset.messageId = message.id;
    bubble.dataset.sessionId = session.id;
  }
  const actions = appendMessageActions(bubble, {
    text: responseText, messageId: message.id,
    onFork: id => callbacks.onFork(id),
    className: "nox-stream-actions",
  });

  const versions = message.responseVersions;
  if (versions && versions.length > 1) {
    const selected = message.responseVersionIndex ?? versions.length - 1;
    const back = createNoxIconButton(actions, {
      cls: "nox-stream-action", icon: "chevron-left",
      label: "Previous response", title: "Previous response",
    });
    back.disabled = selected <= 0;
    const counter = actions.createSpan({
      cls: "nox-response-variant-index", text: (selected + 1) + "/" + versions.length,
    });
    counter.setAttribute("aria-label", "Response version " + (selected + 1) + " of " + versions.length);
    const forward = createNoxIconButton(actions, {
      cls: "nox-stream-action", icon: "chevron-right",
      label: "Next response", title: "Next response",
    });
    forward.disabled = selected >= versions.length - 1;
    const select = (index: number) => {
      if (callbacks.isBusy()) return;
      callbacks.onSelectVersion(messageIndex, index, session.id);
    };
    back.addEventListener("click", () => select(selected - 1));
    forward.addEventListener("click", () => select(selected + 1));
  }

  if (!canRegenerate) return;
  const regenerate = createNoxIconButton(actions, {
    cls: "nox-stream-action", icon: "refresh-cw",
    label: "Regenerate response", title: "Regenerate response",
  });
  regenerate.addEventListener("click", () => {
    if (callbacks.canRegenerate() && user) callbacks.onRegenerate(messageIndex, user, message);
  });
  const quickCheck = createNoxIconButton(actions, {
    cls: "nox-stream-action", icon: "list-checks",
    label: "Quiz me", title: "Generate a practice question from this explanation",
  });
  quickCheck.addEventListener("click", () => {
    if (callbacks.canRegenerate()) callbacks.onQuickCheck(responseText);
  });
}
