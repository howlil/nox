import type { ChatReplyReference } from "../types";
import { createNoxIconButton } from "./primitives";

/** Native DOM selection scoped strictly to one completed assistant message. */
export function captureTranscriptSelection(
  thread: HTMLElement,
): { reference: ChatReplyReference; bounds: DOMRect } | null {
  const selection = thread.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const source = (node: Node | null): HTMLElement | null => {
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest<HTMLElement>(".nox-bubble--agent[data-message-id]") ?? null;
  };
  const anchor = source(selection.anchorNode);
  if (!anchor || anchor !== source(selection.focusNode) || !thread.contains(anchor)) return null;
  const content = anchor.querySelector<HTMLElement>(".nox-message-content");
  if (!content?.contains(selection.anchorNode) || !content.contains(selection.focusNode)) return null;
  const quote = selection.toString().trim();
  if (!quote || quote.length > 4000 || !anchor.dataset.messageId || !anchor.dataset.sessionId) return null;
  return {
    reference: { sourceSessionId: anchor.dataset.sessionId,
      sourceMessageId: anchor.dataset.messageId, sourceRole: "assistant", quote },
    bounds: selection.getRangeAt(0).getBoundingClientRect(),
  };
}

/** Toolbar is deliberately not part of the transcript or the model context. */
export class TranscriptSelectionController {
  private readonly toolbar: HTMLElement;
  private pending: ChatReplyReference | null = null;
  private readonly onPointerUp = () => this.update();
  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.hide(); else this.update();
  };
  private readonly onScroll = () => this.hide();

  constructor(
    private readonly root: HTMLElement,
    private readonly thread: HTMLElement,
    private readonly onAsk: (reference: ChatReplyReference) => void,
  ) {
    this.toolbar = root.createDiv({ cls: "nox-transcript-selection-toolbar nox-hidden" });
    const ask = createNoxIconButton(this.toolbar, {
      cls: "nox-selection-ask", icon: "message-circle-question",
      label: "Ask AI about selected text", title: "Ask AI",
    });
    ask.createSpan({ cls: "nox-selection-ask-label", text: "Ask AI" });
    ask.addEventListener("pointerdown", event => event.preventDefault());
    ask.addEventListener("click", () => {
      const reference = this.pending;
      this.hide();
      if (reference) this.onAsk(reference);
    });
    thread.addEventListener("pointerup", this.onPointerUp);
    thread.addEventListener("keyup", this.onKeyUp);
    thread.addEventListener("scroll", this.onScroll, { passive: true });
  }

  private update(): void {
    const captured = captureTranscriptSelection(this.thread);
    if (!captured) { this.hide(); return; }
    const root = this.root.getBoundingClientRect();
    const thread = this.thread.getBoundingClientRect();
    const center = (captured.bounds.left + captured.bounds.right) / 2;
    const x = Math.max(thread.left + 50, Math.min(thread.right - 50, center));
    const top = captured.bounds.top - 38;
    this.pending = captured.reference;
    this.toolbar.toggleClass("nox-hidden", false);
    this.toolbar.setCssStyles({
      left: `${x - root.left}px`,
      top: `${Math.max(thread.top + 4, top) - root.top}px`,
    });
  }

  hide(): void {
    this.pending = null;
    this.toolbar.addClass("nox-hidden");
  }

  destroy(): void {
    this.thread.removeEventListener("pointerup", this.onPointerUp);
    this.thread.removeEventListener("keyup", this.onKeyUp);
    this.thread.removeEventListener("scroll", this.onScroll);
    this.toolbar.remove();
  }
}
