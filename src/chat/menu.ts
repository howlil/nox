export class NoxMenuState {
  private openState = false;
  private active = 0;
  private rows: HTMLElement[] = [];

  get isOpen(): boolean {
    return this.openState;
  }

  get activeIndex(): number {
    return this.active;
  }

  get rowCount(): number {
    return this.rows.length;
  }

  openAt(index = 0): void {
    this.openState = true;
    this.setActive(index);
  }

  close(): void {
    this.openState = false;
    this.active = 0;
    this.syncRows();
  }

  setRows(rows: HTMLElement[]): void {
    this.rows = rows;
    this.setActive(this.active);
  }

  setActive(index: number): void {
    if (this.rows.length === 0) {
      this.active = Math.max(0, index);
      return;
    }

    this.active = Math.min(Math.max(0, index), this.rows.length - 1);
    this.syncRows();
  }

  move(direction: 1 | -1): void {
    if (this.rows.length === 0) return;
    this.active =
      (this.active + direction + this.rows.length) % this.rows.length;
    this.syncRows();
  }

  syncRows(): void {
    this.rows.forEach((row, index) => {
      const selected = index === this.active;
      row.toggleClass("is-active", selected);
    });
  }

  syncTrigger(trigger: HTMLElement, menuId: string): void {
    trigger.setAttribute("aria-controls", menuId);
    trigger.setAttribute("aria-expanded", String(this.openState));

    const activeRow = this.openState ? this.rows[this.active] : undefined;
    if (activeRow?.id) {
      trigger.setAttribute("aria-activedescendant", activeRow.id);
    } else {
      trigger.removeAttribute("aria-activedescendant");
    }
  }
}
