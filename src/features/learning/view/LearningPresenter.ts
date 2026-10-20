import type { NoxProgramOverview } from "../../../application/learning-types";
import type { ActivitySummary } from "../../../domain/activity/aggregation";
import { setNoxIcon } from "../../../chat/primitives";

export type ActivityScope = "active" | "all";

export interface LearningUiPort {
  thread(): HTMLElement;
  overview(): Promise<NoxProgramOverview | null>;
  activity(scope: ActivityScope): Promise<ActivitySummary>;
  mountMap(
    overview: NoxProgramOverview | null, onClose: () => void,
    onNext: () => void, onCommand: (command: string) => void,
  ): HTMLElement;
  mountActivity(summary: ActivitySummary, scope: ActivityScope,
    onClose: () => void, onScopeChange: (next: ActivityScope) => void): HTMLElement;
  onNext(overview: NoxProgramOverview | null): void;
  onCommand(command: string): void;
  reportError(message: string): void;
}

/** Owns the lifecycle of in-thread learning surfaces; program data is read-only here. */
export class LearningPresenter {
  private map: HTMLElement | null = null;
  private activityPanel: HTMLElement | null = null;
  private epoch = 0;
  private mapRequest = 0;
  private activityRequest = 0;
  private focusRequest = 0;

  constructor(private readonly port: LearningUiPort) {}

  get hasMap(): boolean { return Boolean(this.map?.isConnected); }

  closeMap(): void {
    ++this.mapRequest;
    this.map?.remove();
    this.map = null;
  }

  closeActivity(): void {
    ++this.activityRequest;
    this.activityPanel?.remove();
    this.activityPanel = null;
  }

  reset(): void {
    ++this.epoch;
    ++this.focusRequest;
    this.closeMap();
    this.closeActivity();
  }

  dispose(): void { this.reset(); }

  async toggleMap(): Promise<void> {
    if (this.hasMap) { this.closeMap(); return; }
    const epoch = this.epoch;
    const request = ++this.mapRequest;
    try {
      const overview = await this.port.overview();
      if (epoch !== this.epoch || request !== this.mapRequest ||
          !this.port.thread().isConnected) return;
      this.map = this.port.mountMap(overview,
        () => this.closeMap(),
        () => {
          if (epoch !== this.epoch) return;
          this.closeMap();
          this.port.onNext(overview);
        },
        command => {
          if (epoch !== this.epoch) return;
          this.closeMap();
          this.port.onCommand(command);
        });
      this.port.thread().scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (epoch === this.epoch && request === this.mapRequest) {
        this.port.reportError(error instanceof Error ? error.message : "Learning map unavailable.");
      }
    }
  }

  async toggleActivity(scope: ActivityScope = "active"): Promise<void> {
    if (this.activityPanel?.isConnected && scope === "active") {
      this.closeActivity();
      return;
    }
    const epoch = this.epoch;
    const request = ++this.activityRequest;
    try {
      const summary = await this.port.activity(scope);
      if (epoch !== this.epoch || request !== this.activityRequest ||
          !this.port.thread().isConnected) return;
      this.activityPanel?.remove();
      this.activityPanel = this.port.mountActivity(summary, scope,
        () => this.closeActivity(),
        next => {
          // Switching filters is a new read, not a toggle-close.
          this.closeActivity();
          void this.toggleActivity(next);
        });
      this.port.thread().prepend(this.activityPanel);
      this.activityPanel.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      if (epoch === this.epoch && request === this.activityRequest) {
        this.port.reportError(error instanceof Error ? error.message : "Learning activity unavailable.");
      }
    }
  }

  /** Read-only focus label. Program state and revisions remain authoritative. */
  async refreshFocusStrip(strip: HTMLButtonElement | null): Promise<void> {
    const epoch = this.epoch;
    const request = ++this.focusRequest;
    if (!strip?.isConnected) return;
    try {
      const overview = await this.port.overview();
      if (epoch !== this.epoch || request !== this.focusRequest || !strip.isConnected) return;
      const focus = overview?.focus;
      const objective = overview?.objectives.find(item =>
        item.objective.id === focus?.objectiveId);
      if (!focus && !overview?.revisionPreview) {
        strip.addClass("nox-hidden");
        strip.empty();
        return;
      }
      strip.removeClass("nox-hidden");
      strip.empty();
      const icon = strip.createSpan({ cls: "nox-focus-strip-icon" });
      setNoxIcon(icon, focus?.status === "paused" ? "pause-circle"
        : focus ? "target" : "git-branch");
      const label = focus
        ? (focus.status === "paused" ? "Paused · " : "Focus · ") +
          (objective?.objective.title ?? focus.objectiveId)
        : "Curriculum revision awaiting approval";
      strip.createSpan({ cls: "nox-focus-strip-label", text: label });
      const chevron = strip.createSpan({ cls: "nox-focus-strip-chevron" });
      setNoxIcon(chevron, "chevron-right");
    } catch {
      // Broken program storage must not prevent ordinary chat usage.
      if (epoch === this.epoch && request === this.focusRequest) strip.addClass("nox-hidden");
    }
  }
}
