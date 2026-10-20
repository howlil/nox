import type { ChatSession } from "../../../types";
import { NoxHistoryList, type NoxHistoryCallbacks } from "../../../chat/history-list";
import { NoxMenuState } from "../../../chat/menu";
import { animateNoxPopover } from "../../../chat/motion";
import { NoxPopoverState } from "../../../chat/popover";

/** Owns history menu presentation, accessibility and swipe lifecycle.
 * Session selection, archive and delete are delegated to the caller.
 */
export class HistoryPresenter {
  private readonly state = new NoxMenuState();
  private readonly popover: NoxPopoverState;
  private readonly list: NoxHistoryList;

  constructor(
    private readonly trigger: HTMLButtonElement,
    private readonly menu: HTMLElement,
    callbacks: NoxHistoryCallbacks,
    private readonly snapshot: () => { sessions: ChatSession[]; activeId: string },
  ) {
    this.popover = new NoxPopoverState(menu);
    this.list = new NoxHistoryList(menu, callbacks);
  }

  get isOpen(): boolean { return this.state.isOpen; }

  toggle(beforeOpen: () => void): void {
    if (this.state.isOpen) {
      this.close();
      return;
    }
    beforeOpen();
    this.state.openAt(0);
    this.render();
  }

  close(): void {
    this.list.resetSwipe();
    this.state.close();
    this.popover.close();
    this.syncTrigger();
  }

  render(): void {
    this.popover.setOpen(this.state.isOpen);
    this.syncTrigger();
    if (!this.state.isOpen) return;
    const { sessions, activeId } = this.snapshot();
    this.list.render(sessions, activeId);
    animateNoxPopover(this.menu);
  }

  private syncTrigger(): void {
    this.state.syncTrigger(this.trigger, "nox-history-menu");
  }
}
