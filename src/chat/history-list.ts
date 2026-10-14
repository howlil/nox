import { Notice } from "obsidian";
import type { ChatSession } from "../types";
import { setNoxIcon } from "./primitives";

type HistoryAction = "archive" | "restore" | "delete";

export interface NoxHistoryCallbacks {
  open(id: string): Promise<void>;
  mutate(ids: string[], action: HistoryAction): Promise<void>;
  confirmDelete(count: number): Promise<boolean>;
}

/**
 * Native Obsidian adaptation of UIArc Swipe Actions.
 * Touch: swipe left to reveal actions or right for the primary archive action.
 * Desktop/keyboard: the visible More actions button exposes the same controls.
 * All actual mutations are delegated through LearningController.
 */
export class NoxHistoryList {
  private scope: "active" | "archived" = "active";
  private selecting = false;
  private selected = new Set<string>();
  private expanded: { id: string; side: "leading" | "trailing" } | null = null;
  private busy = false;
  private sessions: ChatSession[] = [];
  private currentId = "";

  constructor(private readonly parent: HTMLElement, private readonly callbacks: NoxHistoryCallbacks) {}

  render(sessions: ChatSession[], currentId: string): void {
    this.sessions = sessions;
    this.currentId = currentId;
    const eligible = new Set(sessions.filter(session => Boolean(session.archivedAt) === (this.scope === "archived")).map(session => session.id));
    for (const id of this.selected) if (!eligible.has(id)) this.selected.delete(id);
    this.parent.empty();

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
        this.selected.clear();
        this.expanded = null;
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
    open.setAttribute("aria-label", `${this.title(session)}. ${this.preview(session)}`);
    open.disabled = this.busy;
    let suppressClick = false;
    open.addEventListener("click", () => {
      if (suppressClick) return;
      if (this.selecting) this.toggleSelected(session.id);
      else if (archived) void this.run([session.id], "restore");
      else void this.callbacks.open(session.id).catch(error => this.report(error));
    });
    const more = front.createEl("button", {
      cls: "nox-history-more",
      attr: { type: "button", "aria-label": `More actions for ${this.title(session)}`,
        "aria-expanded": String(this.expanded?.id === session.id) },
    });
    setNoxIcon(more, "more-horizontal");
    more.disabled = this.busy;
    more.addEventListener("click", () => {
      if (this.selecting) return;
      this.expanded = this.expanded?.id === session.id ? null : { id: session.id, side: "trailing" };
      this.render(this.sessions, this.currentId);
    });
    if (this.selecting) more.addClass("nox-hidden");

    this.setPosition(front, session.id);

    // Do not hijack touch scrolling; only follow a clearly horizontal gesture.
    let startX = 0, startY = 0, dx = 0, dragging = false, pointerId = -1;
    front.addEventListener("pointerdown", event => {
      if (this.selecting || this.busy || event.pointerType === "mouse" ||
          (event.target as HTMLElement).closest("input, .nox-history-more")) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dx = 0;
      dragging = false;
    });
    front.addEventListener("pointermove", event => {
      if (pointerId !== event.pointerId) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!dragging && (Math.abs(deltaX) < 9 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.3)) return;
      dragging = true;
      dx = deltaX;
      const shift = Math.max(-144, Math.min(72, deltaX));
      front.style.transform = `translateX(${shift}px)`;
    });
    const settle = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      pointerId = -1;
      if (!dragging) return;
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 0);
      if (Math.abs(dx) > Math.max(200, front.clientWidth * 0.65)) {
        this.expanded = null;
        void this.run([session.id], primaryAction);
      } else {
        this.expanded = Math.abs(dx) >= 45 ?
          { id: session.id, side: dx > 0 ? "leading" : "trailing" } : null;
        this.render(this.sessions, this.currentId);
      }
    };
    front.addEventListener("pointerup", settle);
    front.addEventListener("pointercancel", () => {
      pointerId = -1;
      this.setPosition(front, session.id);
    });
  }

  private setPosition(front: HTMLElement, id: string): void {
    const offset = this.expanded?.id === id ? (this.expanded.side === "trailing" ? -144 : 72) : 0;
    front.style.transform = `translateX(${offset}px)`;
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
