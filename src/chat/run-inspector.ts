import type { TurnContextSnapshot } from "../context/context-types";

/** Beautiful UI-inspired tool chips and context cards, adapted to Obsidian native DOM.
 * Facts only: no inferred tool calls, reasoning, cost, or token estimates.
 */
export class NoxRunInspector {
  private readonly details: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly context: HTMLElement;
  private readonly activity: HTMLElement;
  private readonly calls = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.details = parent.createEl("details", { cls: "nox-run-inspector" });
    this.summary = this.details.createEl("summary", { text: "Context details" });
    this.context = this.details.createDiv({ cls: "nox-run-context" });
    this.activity = this.details.createDiv({ cls: "nox-run-activities" });
    this.context.createDiv({ cls: "nox-inspector-placeholder", text: "Context not resolved yet." });
    // Tool activity belongs in the live timeline; diagnostic rows stay hidden until observed.
  }

  setContext(snapshot: TurnContextSnapshot): void {
    this.context.empty();
    this.context.createDiv({ cls: "nox-inspector-heading", text: "Context supplied" });
    const sources = [...snapshot.visible.map(item => ({
      file: item.file, chars: item.content.length, excerpt: item.content.slice(0, 320), system: false })),
      ...snapshot.system.map(item => ({
        file: item.file, chars: item.content.length, excerpt: "", system: true }))];
    this.summary.textContent = sources.length === 0
      ? "Context details"
      : `Context · ${sources.length} ${sources.length === 1 ? "source" : "sources"}`;
    if (sources.length === 0) {
      this.context.createDiv({ cls: "nox-inspector-placeholder", text: "No note context included." });
      return;
    }
    for (const item of sources.slice(0, 24)) {
      // Explicit, real passages only. System instructions are never previewed.
      const card = this.context.createEl("details", { cls: "nox-source-card" });
      const summary = card.createEl("summary");
      summary.createSpan({ text: item.file });
      summary.createSpan({ cls: "nox-inspector-muted",
        text: item.chars.toLocaleString() + " chars" + (item.system ? " · system" : "") });
      if (!item.system) {
        const preview = card.createDiv({ cls: "nox-source-preview" });
        preview.setText(item.excerpt + (item.chars > 320 ? "…" : ""));
      } else {
        card.createDiv({ cls: "nox-inspector-muted", text: "System context preview is restricted." });
      }
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
