import { setNoxIcon } from "./primitives";
import type { ActivitySummary } from "../../packages/core/src/domain/activity/aggregation";

function localDay(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}
function duration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  return rounded >= 60 ? `${Math.floor(rounded / 60)}h ${rounded % 60}m` : `${rounded}m`;
}

/** Read-only heatmap derived from canonical session timing; zero and legacy unknown are distinct. */
export function renderLearningActivity(
  parent: HTMLElement,
  summary: ActivitySummary,
  options: { scope: "active" | "all"; onScopeChange(scope: "active" | "all"): void; onClose(): void },
): HTMLElement {
  const panel = parent.createDiv({ cls: "nox-activity-panel" });
  const top = panel.createDiv({ cls: "nox-activity-top" });
  top.createDiv({ cls: "nox-activity-heading", text: "Learning activity" });
  const close = top.createEl("button", { cls: "nox-button nox-button--quiet", attr: { type: "button", "aria-label": "Close activity dashboard" } });
  setNoxIcon(close, "x");
  close.addEventListener("click", () => options.onClose());

  const filters = panel.createDiv({ cls: "nox-activity-scopes" });
  for (const scope of ["active", "all"] as const) {
    const button = filters.createEl("button", { text: scope === "active" ? "Current program" : "All programs",
      cls: `nox-button ${scope === options.scope ? "nox-button--accent" : "nox-button--quiet"}`,
      attr: { type: "button", "aria-pressed": String(scope === options.scope) } });
    button.addEventListener("click", () => options.onScopeChange(scope));
  }

  const stats = panel.createDiv({ cls: "nox-activity-stats" });
  for (const [number, title] of [
    [duration(summary.focusMinutes), "Focus time"],
    [String(summary.activeDays), "Active days"],
    [String(summary.sessions), "Sessions"],
  ]) {
    const item = stats.createDiv({ cls: "nox-activity-stat" });
    item.createDiv({ cls: "nox-activity-value", text: number });
    item.createDiv({ cls: "nox-onboarding-detail", text: title });
  }
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - 97);
  const grid = panel.createDiv({ cls: "nox-activity-heatmap", attr: { role: "group", "aria-label": "Recorded focus time for the last 98 days" } });
  for (let i = 0; i < 98; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const date = localDay(d), mins = (summary.days[date] ?? 0) / 60_000;
    const level = mins === 0 ? 0 : mins < 15 ? 1 : mins < 30 ? 2 : mins < 60 ? 3 : 4;
    const day = grid.createDiv({ cls: `nox-activity-day nox-activity-day--${level}` });
    const desc = `${date}: ${duration(mins)} focus`;
    day.title = desc;
    day.setAttribute("aria-label", desc);
  }
  panel.createDiv({ cls: "nox-onboarding-detail",
    text: "Recorded focus only · AI wait and unobserved time excluded" });
  if (summary.materials.length) {
    panel.createDiv({ cls: "nox-onboarding-label", text: "Time by note" });
    const materials = panel.createDiv({ cls: "nox-activity-materials" });
    for (const item of summary.materials.slice(0, 5)) {
      const row = materials.createDiv({ cls: "nox-activity-material" });
      const label = row.createSpan({ text: item.path });
      label.title = item.path;
      row.createSpan({ text: duration(item.minutes), cls: "nox-activity-duration" });
    }
  }
  return panel;
}
