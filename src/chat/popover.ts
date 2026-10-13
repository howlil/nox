export type NoxPopoverOptions = {
  cls: string;
  id: string;
  label: string;
  role?: "listbox" | "menu" | "dialog";
};

export function createNoxPopover(
  parent: HTMLElement,
  options: NoxPopoverOptions,
): HTMLElement {
  const element = parent.createDiv({
    cls: `nox-popover nox-hidden ${options.cls}`,
    attr: {
      id: options.id,
      role: options.role ?? "dialog",
      "aria-label": options.label,
      "aria-hidden": "true",
    },
  });
  return element;
}

export class NoxPopoverState {
  private openState = false;

  constructor(private readonly element: HTMLElement) {}

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  setOpen(open: boolean): void {
    this.openState = open;
    this.element.toggleClass("nox-hidden", !open);
    this.element.setAttribute("aria-hidden", String(!open));
  }
}
