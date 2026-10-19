/** Coalesces streamed response text into one DOM text node per animation frame.
 * This is presentation-only; it never commits the assistant transcript.
 */
export interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

export class StreamTextPresenter {
  private frame: number | null = null;
  private node: Text | null = null;
  private pending = "";
  private accumulated = "";
  private container: HTMLElement | null = null;

  constructor(private readonly scheduler: FrameScheduler) {}

  get text(): string { return this.accumulated; }

  append(container: HTMLElement, delta: string): void {
    if (this.container !== container) {
      this.flush();
      this.container = container;
      this.node = null;
    }
    this.accumulated += delta;
    this.pending += delta;
    if (this.frame === null) {
      this.frame = this.scheduler.request(() => {
        this.frame = null;
        this.flush();
      });
    }
  }

  flush(): void {
    if (this.frame !== null) {
      this.scheduler.cancel(this.frame);
      this.frame = null;
    }
    if (!this.container || !this.pending) return;
    if (!this.node) {
      this.node = this.container.ownerDocument.createTextNode("");
      this.container.appendChild(this.node);
    }
    this.node.appendData(this.pending);
    this.pending = "";
  }

  /** Drop DOM references after Markdown rendering without losing action text. */
  detach(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    this.pending = "";
    this.node = null;
    this.container = null;
  }

  reset(): void {
    this.detach();
    this.accumulated = "";
  }

  dispose(): void { this.reset(); }
}
