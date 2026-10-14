import type { TurnContextSnapshot } from "../context/context-types";
import type { AgentUsageRecord } from "../domain/telemetry/token-usage";

/** Beautiful UI-inspired tool chips and context cards, adapted to Obsidian native DOM.
 * Facts only: no inferred tool calls, reasoning, cost, or token estimates.
 */
export class NoxRunInspector {
  private readonly details: HTMLElement;
  private readonly context: HTMLElement;
  private readonly activity: HTMLElement;
  private readonly usage: HTMLElement;
  private readonly calls = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.details = parent.createEl("details", { cls: "nox-run-inspector" });
    this.details.createEl("summary", { text: "Run details" });
    this.context = this.details.createDiv({ cls: "nox-run-context" });
    this.activity = this.details.createDiv({ cls: "nox-run-activities" });
    this.usage = this.details.createDiv({ cls: "nox-run-usage" });
    this.context.createDiv({ cls: "nox-inspector-placeholder", text: "Context not resolved yet." });
    this.activity.createDiv({ cls: "nox-inspector-placeholder", text: "No tool activity reported." });
    this.usage.createDiv({ cls: "nox-inspector-placeholder", text: "Token usage not reported by provider." });
  }

  setContext(snapshot: TurnContextSnapshot): void {
    this.context.empty();
    this.context.createDiv({ cls: "nox-inspector-heading", text: "Context supplied" });
    const sources = [...snapshot.visible.map(item => ({ file: item.file, chars: item.content.length })),
      ...snapshot.system.map(item => ({ file: item.file, chars: item.content.length }))];
    if (sources.length === 0) {
      this.context.createDiv({ cls: "nox-inspector-placeholder", text: "No note context included." });
      return;
    }
    for (const item of sources.slice(0, 24)) {
      const row = this.context.createDiv({ cls: "nox-inspector-row" });
      row.createSpan({ text: item.file });
      row.createSpan({ cls: "nox-inspector-muted", text: item.chars.toLocaleString() + " chars" });
    }
    if (sources.length > 24) {
      this.context.createDiv({ cls: "nox-inspector-muted", text: `+${sources.length - 24} additional sources` });
    }
  }

  toolStarted(id: string, name: string): void {
    if (this.calls.has(id) || this.calls.size >= 40) return;
    if (this.calls.size === 0) this.activity.empty();
    const row = this.activity.createDiv({ cls: "nox-run-tool", attr: { "data-status": "running" } });
    row.createSpan({ text: name });
    row.createSpan({ cls: "nox-inspector-muted", text: "Running" });
    this.calls.set(id, row);
  }

  toolCompleted(id: string, outcome: "completed" | "failed"): void {
    const row = this.calls.get(id);
    if (!row) return; // Never invent a start event.
    row.dataset.status = outcome;
    const status = row.lastElementChild;
    if (status) status.textContent = outcome === "completed" ? "Completed" : "Failed";
  }

  setUsage(usage: Pick<AgentUsageRecord, "inputTokens" | "outputTokens" | "cachedInputTokens">): void {
    this.usage.empty();
    this.usage.createDiv({ cls: "nox-inspector-heading", text: "Reported token usage" });
    const rows: Array<[string, number]> = [
      ["Input", usage.inputTokens],
      ["Output", usage.outputTokens],
    ];
    if (usage.cachedInputTokens !== undefined) rows.push(["Cached input", usage.cachedInputTokens]);
    for (const [name, count] of rows) {
      const row = this.usage.createDiv({ cls: "nox-inspector-row" });
      row.createSpan({ text: name });
      row.createSpan({ cls: "nox-inspector-count", text: count.toLocaleString() });
    }
  }

  settle(outcome: "completed" | "failed" | "stopped"): void {
    if (outcome === "completed") return;
    for (const row of this.calls.values()) {
      if (row.dataset.status !== "running") continue;
      row.dataset.status = "interrupted";
      const status = row.lastElementChild;
      if (status) status.textContent = "Interrupted";
    }
  }
}
