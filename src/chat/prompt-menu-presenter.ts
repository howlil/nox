import type { IconName } from "obsidian";
import { animateNoxPopover } from "./motion";
import { NoxMenuState } from "./menu";
import { NoxPopoverState } from "./popover";
import { createNoxMenuRow } from "./primitives";
import { parsePromptToken, type PromptMenuKind } from "./prompt-token";

export type PromptMenuAction =
  | { type: "attach" }
  | { type: "info" }
  | { type: "vault-note"; path: string }
  | { type: "scope"; command: string }
  | { type: "learning"; kind: "explain" | "practice" | "review" | "edit" }
  | { type: "programs" }
  | { type: "menu-back" }
  | { type: "switch-program"; id: string };

export interface PromptMenuItem {
  key: string;
  name: string;
  description: string;
  icon: IconName;
  command?: string;
  disabled?: boolean;
  action: PromptMenuAction;
}

export interface PromptMenuPort {
  items(kind: PromptMenuKind, page: "actions" | "programs"): Promise<PromptMenuItem[]>;
  select(item: PromptMenuItem): Promise<void>;
  /** Invalidates read-model cache owned by the outer application coordinator. */
  invalidate(): void;
  reportError(message: string): void;
}

/** UI state is scoped to the mounted Composer; it never owns program or vault data. */
export class PromptMenuPresenter {
  private readonly state = new NoxMenuState();
  private kindValue: PromptMenuKind | null = null;
  private pageValue: "actions" | "programs" = "actions";
  private lastQuery = "";
  private requestId = 0;
  private disposed = false;
  private hint: HTMLButtonElement | null = null;

  constructor(
    private readonly input: HTMLTextAreaElement,
    private readonly menu: HTMLElement,
    private readonly popover: NoxPopoverState,
    private readonly actionTrigger: HTMLButtonElement,
    private readonly port: PromptMenuPort,
  ) {}

  get kind(): PromptMenuKind | null { return this.kindValue; }
  get page(): "actions" | "programs" { return this.pageValue; }
  get isOpen(): boolean { return this.kindValue !== null && !this.disposed; }

  setCommandHint(button: HTMLButtonElement | null): void {
    this.hint = button;
    this.syncControls();
  }

  openCommand(): void {
    if (this.disposed) return;
    this.kindValue = "command";
    this.pageValue = "actions";
    this.state.openAt(0);
    void this.render();
  }

  toggleCommand(): void {
    if (this.kindValue === "command") this.close();
    else this.openCommand();
  }

  onInput(): void {
    if (this.disposed) return;
    const token = parsePromptToken(this.input.value);
    if (token?.kind === "command" && token.query) this.pageValue = "actions";
    if (token && this.kindValue !== token.kind) {
      this.kindValue = token.kind;
      this.state.openAt(0);
    } else if (!token) {
      this.close();
      return;
    }
    void this.render();
  }

  resetSelection(): void {
    if (this.kindValue === "command") this.state.setActive(0);
    this.syncRows();
  }

  close(): void {
    if (this.disposed) return;
    ++this.requestId;
    this.kindValue = null;
    this.pageValue = "actions";
    this.lastQuery = "";
    this.state.close();
    this.state.setRows([]);
    this.port.invalidate();
    this.menu.empty();
    this.popover.close();
    this.input.removeAttribute("aria-expanded");
    this.input.removeAttribute("aria-activedescendant");
    this.syncControls();
  }

  private syncControls(): void {
    const expanded = String(this.kindValue === "command" && !this.disposed);
    this.actionTrigger.setAttribute("aria-expanded", expanded);
    this.hint?.setAttribute("aria-expanded", expanded);
    this.hint?.setAttribute("aria-controls", "nox-prompt-menu");
  }

  private syncRows(): void {
    this.state.syncRows();
    const rows = this.menu.querySelectorAll<HTMLButtonElement>(
      ".nox-prompt-menu-row:not(:disabled)",
    );
    rows.forEach((row, i) => {
      row.setAttribute("aria-selected", String(i === this.state.activeIndex));
    });
    const active = rows[this.state.activeIndex];
    if (active) this.input.setAttribute("aria-activedescendant", active.id);
    else this.input.removeAttribute("aria-activedescendant");
  }

  private async render(): Promise<void> {
    if (this.disposed || !this.kindValue) return;
    const id = ++this.requestId;
    const kind = this.kindValue;
    const page = this.pageValue;
    const token = parsePromptToken(this.input.value);
    const query = token?.kind === kind ? token.query : "";
    this.menu.empty();
    this.popover.setOpen(true);
    this.input.setAttribute("aria-expanded", "true");
    this.syncControls();
    let items: PromptMenuItem[];
    try {
      items = await this.port.items(kind, page);
    } catch (error) {
      if (id === this.requestId && !this.disposed) {
        this.port.reportError(error instanceof Error ? error.message : "Actions unavailable.");
      }
      return;
    }
    if (this.disposed || id !== this.requestId ||
        kind !== this.kindValue || page !== this.pageValue) return;
    // Re-query for the currently visible input; never display rows for an old token.
    const latest = parsePromptToken(this.input.value);
    if ((latest?.kind === kind ? latest.query : "") !== query) return;

    if (kind === "command") {
      const key = page + ":" + query;
      if (key !== this.lastQuery) {
        this.state.setActive(0);
        this.lastQuery = key;
      }
      const head = this.menu.createDiv({ cls: "nox-prompt-menu-heading" });
      head.createSpan({ text: page === "programs" ? "Learning programs" : "Actions" });
      if (page === "actions") head.createSpan({
        cls: "nox-prompt-menu-heading-hint", text: query ? "Search results" : "Quick actions",
      });
    }
    if (!items.length) {
      this.menu.createDiv({
        cls: "nox-prompt-menu-empty",
        text: "No matching actions. Try another keyword.",
      });
    }
    let interactiveIndex = 0;
    const buttons: HTMLButtonElement[] = [];
    for (const item of items) {
      const menuIndex = item.disabled ? -1 : interactiveIndex++;
      const button = createNoxMenuRow(this.menu, {
        cls: "nox-prompt-menu-row",
        ...(item.disabled ? {} : { id: "nox-prompt-menu-option-" + menuIndex }),
        icon: item.icon, iconClass: "nox-prompt-menu-icon",
        name: item.name, nameClass: "nox-prompt-menu-name",
        description: item.description, descriptionClass: "nox-prompt-menu-description",
        command: item.command, commandClass: "nox-prompt-menu-command",
        stacked: kind === "command", disabled: item.disabled,
      });
      if (!item.disabled) {
        button.addEventListener("mouseenter", () => {
          this.state.setActive(menuIndex);
          this.syncRows();
        });
        button.addEventListener("click", () => { void this.pick(item); });
        buttons.push(button);
      }
    }
    this.menu.createDiv({
      cls: "nox-prompt-menu-hint",
      text: kind === "source"
        ? query ? "Select a note or attach a text file" : "Type @name to search vault notes"
        : page === "programs" ? "Select a plan or return to actions"
          : query ? "↑ ↓ navigate · Enter select · Esc close"
            : "Type / plus a keyword for more actions",
    });
    this.state.setRows(buttons);
    this.syncRows();
    animateNoxPopover(this.menu);
  }

  private async pick(item: PromptMenuItem): Promise<void> {
    if (this.disposed || !this.kindValue || item.disabled) return;
    if (item.action.type === "programs" || item.action.type === "menu-back") {
      this.pageValue = item.action.type === "programs" ? "programs" : "actions";
      this.state.openAt(0);
      await this.render();
      return;
    }
    try {
      await this.port.select(item);
    } catch (error) {
      if (!this.disposed) {
        this.port.reportError(error instanceof Error ? error.message : "Could not select action.");
      }
    }
  }

  /** Returns true if this key is consumed by the menu. */
  onKey(event: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    const token = parsePromptToken(this.input.value);
    const selectKey = event.key === "Tab" ||
      (event.key === "Enter" && !event.shiftKey);
    // Invalid / commands must never fall through and start inference.
    if (this.kindValue === "command" && this.state.rowCount === 0 &&
        token?.kind === "command" && selectKey) {
      event.preventDefault();
      return true;
    }
    if (this.state.rowCount > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        this.state.move(event.key === "ArrowDown" ? 1 : -1);
        this.syncRows();
        return true;
      }
      if (selectKey) {
        event.preventDefault();
        const rows = this.menu.querySelectorAll<HTMLButtonElement>(
          ".nox-prompt-menu-row:not(:disabled)",
        );
        rows[this.state.activeIndex]?.click();
        return true;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return true;
    }
    return false;
  }

  dispose(): void {
    this.close();
    ++this.requestId;
    this.disposed = true;
    this.hint = null;
  }
}
