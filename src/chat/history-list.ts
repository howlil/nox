import { Menu, Notice } from "obsidian";
import type { ChatSession } from "../types";
import { setNoxIcon } from "./primitives";
import { HISTORY_SWIPE_LEADING, HISTORY_SWIPE_TRAILING, swipeAxis, swipeOffset, swipeRelease } from "./history-swipe";

type HistoryAction = "archive" | "restore" | "delete";

export interface NoxHistoryCallbacks {
  open(id: string): Promise<void>;
  mutate(ids: string[], action: HistoryAction): Promise<void>;
  confirmDelete(count: number): Promise<boolean>;
}

/**
 * Native Obsidian adaptation of UIArc Swipe Actions.
 * Pointer/touch: direction-locked horizontal swipe, preserving vertical scroll.
 * Desktop/keyboard: a quiet native More actions menu exposes the same controls.
 * All actual mutations are delegated through LearningController.
 */
export class NoxHistoryList {
  private scope: "active" | "archived" = "active";
  private selecting = false;
  private selected = new Set<string>();
  private expanded: { id: string; side: "leading" | "trailing" } | null = null;
  private busy = false;
  private readonly rowRefs = new Map<string, { item: HTMLElement; front: HTMLElement }>();
  private sessions: ChatSession[] = [];
  private currentId = "";

  constructor(private readonly parent: HTMLElement, private readonly callbacks: NoxHistoryCallbacks) {}

  render(sessions: ChatSession[], currentId: string): void {
    const scrollTop = this.parent.querySelector<HTMLElement>(".nox-history-list")?.scrollTop ?? 0;
    this.sessions = sessions;
    this.currentId = currentId;
    const eligible = new Set(sessions.filter(session => Boolean(session.archivedAt) === (this.scope === "archived")).map(session => session.id));
    for (const id of this.selected) if (!eligible.has(id)) this.selected.delete(id);
    this.parent.empty();
    this.rowRefs.clear();

    const header = this.parent.createDiv({ cls: "nox-history-header" });
    header.createSpan({ cls: "nox-history-title", text: "Chat history" });
    const select = header.createEl("button", {
      cls: "nox-history-text-action",
      text: this.selecting ? "Done" : "Select",
      attr: { type: "button", "aria-pressed": String(this.selecting) },
    });
    select.disabled = this.busy;
    select.addEventListener("click", () => {
      this.selecting = !this.selecting;
      this.selected.clear();
      this.expanded = null;
      this.render(this.sessions, this.currentId);
    });

    const tabs = this.parent.createDiv({ cls: "nox-history-tabs", attr: { role: "group", "aria-label": "History folder" } });
    for (const [scope, label] of [["active", "Chats"], ["archived", "Archived"]] as const) {
      const button = tabs.createEl("button", {
        cls: "nox-history-tab",
        text: label,
        attr: { type: "button", "aria-pressed": String(this.scope === scope) },
      });
      button.disabled = this.busy;
      if (this.scope === scope) button.addClass("is-current");
      button.addEventListener("click", () => {
        this.scope = scope;
        this.expanded = null;
        this.selected.clear();
        this.render(this.sessions, this.currentId);
      });
    }

    const visible = sessions.filter(session => Boolean(session.archivedAt) === (this.scope === "archived"));
    if (this.selecting && visible.length > 0) this.renderSelectionBar(visible);

    if (visible.length === 0) {
      this.parent.createDiv({
        cls: "nox-history-empty",
        text: this.scope === "archived" ? "No archived conversations." : "No conversations yet.",
      });
      return;
    }

    const list = this.parent.createEl("ul", {
      cls: "nox-history-list",
      attr: { "aria-label": this.scope === "active" ? "Chats" : "Archived chats" },
    });
    for (const session of visible) this.renderItem(list, session);
    list.scrollTop = scrollTop;
    // Swipe drawers are transient; scrolling must never leave an action layer visible.
    list.addEventListener("scroll", () => this.closeSwipe(), { passive: true });
    list.addEventListener("wheel", () => this.closeSwipe(), { passive: true });
  }

  private renderSelectionBar(visible: ChatSession[]): void {
    const bar = this.parent.createDiv({ cls: "nox-history-selection" });
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "nox-history-checkbox";
    checkbox.setAttribute("aria-label", "Select all visible conversations");
    checkbox.checked = this.selected.size === visible.length;
    checkbox.indeterminate = this.selected.size > 0 && this.selected.size < visible.length;
    checkbox.disabled = this.busy;
    bar.appendChild(checkbox);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected = new Set(visible.map(session => session.id));
      else this.selected.clear();
      this.render(this.sessions, this.currentId);
    });
    bar.createSpan({
      cls: "nox-history-selection-count",
      text: this.selected.size ? `${this.selected.size} selected` : "Select all",
    });
    const action = this.scope === "archived" ? "restore" : "archive";
    const primary = this.actionButton(bar, action === "restore" ? "Restore" : "Archive",
      action === "restore" ? "archive-restore" : "archive", () => void this.run([...this.selected], action));
    primary.disabled = this.busy || this.selected.size === 0;
    const remove = this.actionButton(bar, "Delete", "trash-2", () => void this.run([...this.selected], "delete"));
    remove.addClass("is-danger");
    remove.disabled = this.busy || this.selected.size === 0;
  }

  private renderItem(parent: HTMLElement, session: ChatSession): void {
    const item = parent.createEl("li", { cls: "nox-history-item" });
    if (this.selected.has(session.id)) item.addClass("is-selected");
    const archived = Boolean(session.archivedAt);
    const primaryAction: HistoryAction = archived ? "restore" : "archive";
    const primaryLabel = archived ? "Restore" : "Archive";
    const primaryIcon = archived ? "archive-restore" : "archive";

    const leading = item.createDiv({ cls: "nox-history-swipe-actions is-leading" });
    this.actionButton(leading, primaryLabel, primaryIcon,
      () => void this.run([session.id], primaryAction)).disabled = this.busy;

    const trailing = item.createDiv({ cls: "nox-history-swipe-actions is-trailing" });
    this.actionButton(trailing, primaryLabel, primaryIcon,
      () => void this.run([session.id], primaryAction)).disabled = this.busy;
    const deleteButton = this.actionButton(trailing, "Delete", "trash-2", () => void this.run([session.id], "delete"));
    deleteButton.addClass("is-danger");
    deleteButton.disabled = this.busy;

    const front = item.createDiv({ cls: "nox-history-swipe-front" });
    const checked = this.selecting ? document.createElement("input") : null;
    if (checked) {
      checked.type = "checkbox";
      checked.className = "nox-history-checkbox";
      checked.checked = this.selected.has(session.id);
      checked.disabled = this.busy;
      checked.setAttribute("aria-label", `Select ${this.title(session)}`);
      front.appendChild(checked);
      checked.addEventListener("change", () => this.toggleSelected(session.id));
    }

    const open = front.createEl("button", {
      cls: "nox-history-entry",
      attr: { type: "button", "aria-current": session.id === this.currentId ? "true" : "false" },
    });
    if (session.id === this.currentId && !archived) open.addClass("is-current");
    const icon = open.createSpan({ cls: "nox-history-entry-icon" });
    setNoxIcon(icon, archived ? "archive" : "message-circle");
    const copy = open.createDiv({ cls: "nox-history-entry-copy" });
    copy.createSpan({ cls: "nox-history-entry-name", text: this.title(session) });
    copy.createSpan({ cls: "nox-history-entry-preview", text: this.preview(session) });
    const time = open.createSpan({ cls: "nox-history-entry-time", text: this.formatTime(session.updatedAt) });
    time.setAttribute("aria-hidden", "true");
    // The visible title already names this button; avoid huge native hover tooltips.
    open.disabled = this.busy;
    let suppressClick = false;
    open.addEventListener("click", () => {
      if (suppressClick) return;
      if (this.expanded?.id === session.id) {
        this.closeSwipe();
        return;
      }
      if (this.selecting) this.toggleSelected(session.id);
      else if (archived) void this.run([session.id], "restore");
      else void this.callbacks.open(session.id).catch(error => this.report(error));
    });
    const more = front.createEl("button", {
      cls: "nox-history-more",
      attr: { type: "button", "aria-label": `More actions for ${this.title(session)}`,
        "aria-haspopup": "menu" },
    });
    setNoxIcon(more, "more-horizontal");
    more.disabled = this.busy;
    more.addEventListener("click", () => {
      if (this.selecting || this.busy) return;
      this.closeSwipe();
      const menu = new Menu();
      menu.addItem(entry => entry.setTitle(primaryLabel).setIcon(primaryIcon)
        .onClick(() => void this.run([session.id], primaryAction)));
      menu.addItem(entry => entry.setTitle("Delete").setIcon("trash-2")
        .onClick(() => void this.run([session.id], "delete")));
      const bounds = more.getBoundingClientRect();
      menu.showAtPosition({ x: Math.round(bounds.right), y: Math.round(bounds.bottom) });
    });
    if (this.selecting) more.addClass("nox-hidden");

    this.rowRefs.set(session.id, { item, front });
    this.positionRow(session.id, this.expanded?.id === session.id ? this.expanded.side : null);

    // Capture only once a horizontal gesture has won the axis lock. Capturing
    // on pointerdown would break normal button clicks and touch page scrolling.
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let lastX = 0;
    let lastAt = 0;
    let velocityX = 0;
    let axis: "undecided" | "horizontal" | "vertical" = "undecided";

    front.addEventListener("pointerdown", event => {
      if (this.selecting || this.busy || (event.pointerType === "mouse" && event.button !== 0) ||
          (event.target as HTMLElement).closest("input, .nox-history-more")) return;
      pointerId = event.pointerId;
      startX = lastX = event.clientX;
      startY = event.clientY;
      startOffset = this.expanded?.id === session.id ?
        (this.expanded.side === "trailing" ? -HISTORY_SWIPE_TRAILING : HISTORY_SWIPE_LEADING) : 0;
      lastAt = event.timeStamp;
      velocityX = 0;
      axis = "undecided";
    });

    front.addEventListener("pointermove", event => {
      if (pointerId !== event.pointerId || axis === "vertical") return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (axis === "undecided") {
        const next = swipeAxis(dx, dy);
        if (next === "undecided") return;
        axis = next;
        if (next === "vertical") {
          pointerId = -1;
          return;
        }
        this.closeSwipe(session.id);
        front.style.transition = "none";
        try { front.setPointerCapture(event.pointerId); } catch { /* gesture may have ended */ }
      }
      const elapsed = Math.max(1, event.timeStamp - lastAt);
      velocityX = ((event.clientX - lastX) / elapsed) * 1000;
      lastX = event.clientX;
      lastAt = event.timeStamp;
      const offset = swipeOffset(dx, startOffset);
      this.revealDirection(item, offset >= 0 ? "leading" : "trailing", false);
      front.style.transform = `translate3d(${offset}px, 0, 0)`;
      event.preventDefault();
    });

    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = -1;
      if (axis !== "horizontal") return;
      // Prevent a drag ending over a button from also selecting/opening the chat.
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 0);
      front.style.transition = "";
      const dragged = startOffset + event.clientX - startX;
      const result = swipeRelease(dragged, velocityX, item.clientWidth);
      if (result.full) {
        this.closeSwipe();
        // Full swipe left is guarded by the same delete confirmation as the menu.
        void this.run([session.id], result.side === "trailing" ? "delete" : primaryAction);
        return;
      }
      this.closeSwipe(session.id);
      this.expanded = result.side ? { id: session.id, side: result.side } : null;
      this.positionRow(session.id, result.side);
    };
    front.addEventListener("pointerup", finish);
    front.addEventListener("pointercancel", event => {
      if (pointerId !== event.pointerId) return;
      pointerId = -1;
      axis = "undecided";
      front.style.transition = "";
      this.closeSwipe();
    });
  }

  /** Only one swipe row can remain revealed. Scroll collapses it immediately. */
  /** Hide action drawers whenever the history popover is dismissed. */
  resetSwipe(): void {
    this.closeSwipe();
  }

  private closeSwipe(exceptId?: string): void {
    for (const [id] of this.rowRefs) {
      if (id !== exceptId) this.positionRow(id, null);
    }
    if (this.expanded?.id !== exceptId) this.expanded = null;
  }

  private revealDirection(item: HTMLElement, side: "leading" | "trailing" | null, interactive: boolean): void {
    item.toggleClass("is-swipe-leading", side === "leading");
    item.toggleClass("is-swipe-trailing", side === "trailing");
    for (const actions of Array.from(item.querySelectorAll<HTMLElement>(".nox-history-swipe-actions"))) {
      const enabled = interactive && side !== null &&
        actions.classList.contains(side === "leading" ? "is-leading" : "is-trailing");
      actions.setAttribute("aria-hidden", String(!enabled));
      for (const button of Array.from(actions.querySelectorAll<HTMLButtonElement>("button"))) {
        button.tabIndex = enabled ? 0 : -1;
      }
    }
  }

  private positionRow(id: string, side: "leading" | "trailing" | null): void {
    const row = this.rowRefs.get(id);
    if (!row) return;
    const offset = side === "leading" ? HISTORY_SWIPE_LEADING :
      side === "trailing" ? -HISTORY_SWIPE_TRAILING : 0;
    row.front.style.transition = "";
    row.front.style.transform = `translate3d(${offset}px, 0, 0)`;
    this.revealDirection(row.item, side, true);
  }

  private toggleSelected(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.render(this.sessions, this.currentId);
  }

  private actionButton(parent: HTMLElement, label: string, icon: string, click: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "nox-history-action", attr: { type: "button", "aria-label": label } });
    const graphic = button.createSpan();
    setNoxIcon(graphic, icon);
    button.createSpan({ text: label });
    button.addEventListener("click", click);
    return button;
  }

  private async run(ids: string[], action: HistoryAction): Promise<void> {
    if (this.busy || ids.length === 0) return;
    if (action === "delete" && !(await this.callbacks.confirmDelete(ids.length))) return;
    this.busy = true;
    this.render(this.sessions, this.currentId);
    try {
      await this.callbacks.mutate(ids, action);
      this.selected.clear();
      this.expanded = null;
    } catch (error) {
      this.report(error);
    } finally {
      this.busy = false;
      this.render(this.sessions, this.currentId);
    }
  }

  private report(error: unknown): void {
    new Notice(error instanceof Error ? error.message : "Unable to update chat history.");
  }

  private title(session: ChatSession): string {
    const first = session.messages.find(message => message.role === "user" && message.content.trim())?.content ?? "";
    return this.truncate(first || "New session", 48);
  }

  private preview(session: ChatSession): string {
    const last = [...session.messages].reverse().find(message => message.content.trim());
    if (!last) return "No messages yet";
    const count = session.messages.length;
    return `${count} ${count === 1 ? "message" : "messages"} · ${this.truncate(last.content, 48)}`;
  }

  private truncate(value: string, max: number): string {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    if (date.toDateString() === new Date().toDateString()) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}
