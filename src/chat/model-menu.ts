import type { AgentModel } from "@nox/core";
import { NoxMenuState } from "./menu";
import { animateNoxPopover } from "./motion";
import { NoxPopoverState } from "./popover";
import { createNoxMenuRow } from "./primitives";

/** Show manual model IDs too when the runtime has no discovery catalog. */
export function modelMenuItems(models: AgentModel[], selected?: string): AgentModel[] {
  return [
    { id: "", name: "Runtime default" },
    ...models,
    ...(selected && !models.some((model) => model.id === selected)
      ? [{ id: selected, name: selected }] : []),
  ];
}


/** Presentation-only port; runtime catalog and session model remain application-owned. */
export interface ModelMenuPort {
  models(): AgentModel[];
  selectedId(): string | undefined;
  discoveryError(): string | null | undefined;
  discover(): Promise<void>;
  select(id: string): Promise<void>;
  setLabel(label: string): void;
  beforeOpen(): void;
  reportError(message: string): void;
}

/** Owns model popover, keyboard navigation, discovery/loading UI and focus cleanup. */
export class ModelMenuPresenter {
  private readonly state = new NoxMenuState();
  private models: AgentModel[] = [];
  private discoveryLoading = false;
  private selecting = false;
  private disposed = false;
  private generation = 0;

  constructor(
    private readonly trigger: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly popover: NoxPopoverState,
    private readonly port: ModelMenuPort,
  ) {
    this.refresh();
  }

  get isOpen(): boolean { return this.state.isOpen; }

  private items(): AgentModel[] {
    return modelMenuItems(this.models, this.port.selectedId());
  }

  private selectedIndex(): number {
    const selected = this.port.selectedId() ?? "";
    const index = this.items().findIndex(model => model.id === selected);
    return index < 0 ? 0 : index;
  }

  refresh(): void {
    if (this.disposed) return;
    this.models = this.port.models();
    if (this.isOpen) this.state.setActive(this.selectedIndex());
    this.render();
  }

  private syncTrigger(): void {
    const selected = this.port.selectedId() ?? "";
    const model = this.items().find(item => item.id === selected);
    const label = !selected && !this.models.length && this.port.discoveryError()
      ? "Models unavailable" : model?.name ?? "Runtime default";
    this.port.setLabel(label);
    this.state.syncTrigger(this.trigger, "nox-model-menu");
    this.trigger.setAttribute("aria-label", "Learning model: " + label);
  }

  private async discover(): Promise<void> {
    if (this.discoveryLoading || this.disposed) return;
    const generation = this.generation;
    this.discoveryLoading = true;
    this.render();
    try {
      await this.port.discover();
    } catch {
      // The application owns the discovery error; refresh its read-only projection.
    } finally {
      if (generation === this.generation && !this.disposed) {
        this.discoveryLoading = false;
        this.refresh();
      }
    }
  }

  open(): void {
    if (this.disposed) return;
    this.models = this.port.models();
    this.port.beforeOpen();
    this.state.openAt(this.selectedIndex());
    this.render();
    if (!this.models.length && !this.port.discoveryError()) void this.discover();
  }

  close(): void {
    if (this.disposed) return;
    if (!this.isOpen && !this.menu.hasChildNodes()) return;
    this.state.close();
    this.render();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private render(): void {
    if (this.disposed) return;
    this.menu.empty();
    this.popover.setOpen(this.isOpen);
    this.syncTrigger();
    if (!this.isOpen) {
      this.state.setRows([]);
      return;
    }

    const selected = this.port.selectedId() ?? "";
    const rows: HTMLButtonElement[] = [];
    for (const [index, model] of this.items().entries()) {
      const row = createNoxMenuRow(this.menu, {
        cls: "nox-model-menu-row",
        id: "nox-model-menu-option-" + index,
        name: model.name,
        nameClass: "nox-model-menu-name",
        selected: model.id === selected,
        trailingClass: "nox-model-menu-check",
        trailingIcon: model.id === selected ? "check" : undefined,
      });
      row.addEventListener("mouseenter", () => {
        this.state.setActive(index);
        this.syncRows();
      });
      row.addEventListener("mousedown", event => event.preventDefault());
      row.addEventListener("click", () => { void this.select(model.id); });
      rows.push(row);
    }
    const error = this.port.discoveryError();
    if (!this.models.length && this.discoveryLoading) {
      this.menu.createDiv({ cls: "nox-model-menu-status", text: "Discovering models…" });
    }
    if (!this.models.length && error && !this.discoveryLoading) {
      this.menu.createDiv({ cls: "nox-model-menu-error", text: error });
      const retry = this.menu.createEl("button", {
        cls: "nox-model-menu-retry", text: "Retry model discovery",
        attr: { type: "button" },
      });
      retry.addEventListener("click", () => {
        retry.disabled = true;
        void this.discover();
      });
    }
    this.state.setRows(rows);
    this.syncRows();
    animateNoxPopover(this.menu);
  }

  private syncRows(): void {
    const selected = this.port.selectedId() ?? "";
    const options = this.items();
    const rows = this.menu.querySelectorAll<HTMLButtonElement>(".nox-model-menu-row");
    rows.forEach((row, index) => {
      row.setAttribute("aria-selected", String(options[index]?.id === selected));
    });
    this.state.syncTrigger(this.trigger, "nox-model-menu");
  }

  private async select(id: string): Promise<void> {
    if (this.disposed || this.selecting) return;
    this.selecting = true;
    try {
      await this.port.select(id);
    } catch (error) {
      if (!this.disposed) {
        // Do not close the selection UI or imply success when persistence fails.
        this.port.reportError(error instanceof Error ? error.message : "Unable to save model selection.");
        this.refresh();
      }
      return;
    } finally {
      this.selecting = false;
    }
    if (this.disposed) return;
    this.close();
    this.trigger.focus();
    this.refresh();
  }

  onTriggerKey(event: KeyboardEvent): void {
    if (this.disposed) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!this.isOpen) { this.open(); return; }
      this.state.move(event.key === "ArrowDown" ? 1 : -1);
      this.syncRows();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && this.isOpen) {
      event.preventDefault();
      const model = this.items()[this.state.activeIndex];
      if (model) void this.select(model.id);
      return;
    }
    if (event.key === "Escape" && this.isOpen) {
      event.preventDefault();
      this.close();
      this.trigger.focus();
    } else if (event.key === "Tab" && this.isOpen) {
      this.close();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    ++this.generation;
    this.state.close();
    this.menu.empty();
    this.popover.setOpen(false);
    this.state.syncTrigger(this.trigger, "nox-model-menu");
    this.disposed = true;
  }
}
