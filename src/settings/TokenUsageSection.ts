import { Setting } from "obsidian";

export interface UsageViewEntry {
  date: string;
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  cacheWriteTokens: number;
}

export interface UsageViewSnapshot {
  trackingSince?: string;
  entries: UsageViewEntry[];
}

export interface UsageViewHost {
  getTokenUsageSnapshot(): Promise<UsageViewSnapshot>;
  getTokenUsageError(): string | undefined;
}

export type UsageFilters = { provider: string; model: string; range: "all" | "7d" | "30d" };

const format = (value: number): string => value.toLocaleString("en-US");

/** Pure, filterable projection from provider-reported daily buckets. */
export function summarizeTokenUsage(
  entries: UsageViewEntry[], filters: UsageFilters, now = new Date(),
): { totals: Omit<UsageViewEntry, "date" | "provider" | "model">; rows: UsageViewEntry[] } {
  const cutoff = filters.range === "all" ? "" : new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() -
      (filters.range === "7d" ? 6 : 29),
  )).toISOString().slice(0, 10);
  const selected = entries.filter(entry =>
    (filters.provider === "all" || entry.provider === filters.provider) &&
    (filters.model === "all" || entry.model === filters.model) &&
    (!cutoff || entry.date >= cutoff));
  const empty = (): UsageViewEntry => ({
    date: "", provider: "", model: "", requests: 0, inputTokens: 0,
    outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0,
    cacheWriteTokens: 0,
  });
  const totals = empty();
  const grouped = new Map<string, UsageViewEntry>();
  for (const row of selected) {
    const key = JSON.stringify([row.provider, row.model]);
    const target = grouped.get(key) ?? { ...empty(), provider: row.provider, model: row.model };
    for (const field of ["requests", "inputTokens", "outputTokens", "totalTokens",
      "cachedInputTokens", "reasoningTokens", "cacheWriteTokens"] as const) {
      totals[field] += row[field];
      target[field] += row[field];
    }
    grouped.set(key, target);
  }
  return {
    totals,
    rows: [...grouped.values()].sort((a, b) => b.totalTokens - a.totalTokens ||
      a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)),
  };
}

export function mountTokenUsageSection(container: HTMLElement, host: UsageViewHost): void {
  const section = container.createDiv({ cls: "nox-usage" });
  section.createEl("h3", { text: "Token usage" });
  section.createEl("p", { cls: "nox-usage-description",
    text: "Tokens reported by requests made through Nox. This is not your provider account's total usage." });
  const body = section.createDiv();
  let snapshot: UsageViewSnapshot = { entries: [] };
  const filters: UsageFilters = { provider: "all", model: "all", range: "all" };

  const render = () => {
    body.empty();
    const controls = body.createDiv({ cls: "nox-usage-filters" });
    const addFilter = (
      name: string, selected: string, options: Array<[string, string]>, change: (value: string) => void,
    ) => {
      new Setting(controls).setName(name).addDropdown(dropdown => {
        for (const [value, label] of options) dropdown.addOption(value, label);
        dropdown.setValue(selected).onChange(change);
      });
    };
    const providers = [...new Set(snapshot.entries.map(item => item.provider))].sort();
    const models = [...new Set(snapshot.entries.filter(item =>
      filters.provider === "all" || item.provider === filters.provider).map(item => item.model))].sort();

    addFilter("Provider", filters.provider,
      [["all", "All providers"], ...providers.map(p => [p, p === "chatgpt" ? "ChatGPT plan" : p.toUpperCase()] as [string, string])],
      value => { filters.provider = value; filters.model = "all"; render(); });
    addFilter("Model", filters.model,
      [["all", "All models"], ...models.map(m => [m, m] as [string, string])],
      value => { filters.model = value; render(); });
    addFilter("Period", filters.range,
      [["all", "All time"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]],
      value => { filters.range = value as UsageFilters["range"]; render(); });

    const { totals, rows } = summarizeTokenUsage(snapshot.entries, filters);
    const metrics = body.createDiv({ cls: "nox-usage-metrics" });
    for (const [label, value] of [
      ["Total tokens", totals.totalTokens], ["Input", totals.inputTokens],
      ["Output", totals.outputTokens], ["Requests", totals.requests],
      ["Cached input", totals.cachedInputTokens], ["Reasoning", totals.reasoningTokens],
    ] as Array<[string, number]>) {
      const metric = metrics.createDiv({ cls: "nox-usage-metric" });
      metric.createEl("span", { text: label });
      metric.createEl("strong", { text: format(value) });
    }
    const coverage = body.createEl("p", { cls: "nox-usage-description" });
    coverage.setText(snapshot.trackingSince
      ? "Tracking since " + new Date(snapshot.trackingSince).toLocaleDateString() +
        " · UTC-day reporting · Recorded requests only."
      : "No token metadata has been recorded yet. Earlier conversations cannot be reconstructed.");
    if (host.getTokenUsageError()) {
      body.createEl("p", { cls: "nox-usage-warning", text: host.getTokenUsageError() });
    }

    body.createEl("h4", { text: "Breakdown by model" });
    if (!rows.length) body.createEl("p", { cls: "nox-usage-description",
      text: "No recorded usage matches these filters." });
    else {
      const table = body.createEl("table", { cls: "nox-usage-table" });
      const head = table.createEl("thead").createEl("tr");
      for (const label of ["Provider", "Model", "Requests", "Tokens"]) head.createEl("th", { text: label });
      const tbody = table.createEl("tbody");
      for (const row of rows) {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: row.provider === "chatgpt" ? "ChatGPT" : row.provider.toUpperCase() });
        tr.createEl("td", { text: row.model });
        tr.createEl("td", { text: format(row.requests) });
        tr.createEl("td", { text: format(row.totalTokens) });
      }
    }

    const limits = body.createDiv({ cls: "nox-usage-limit" });
    limits.createEl("strong", { text: "Account limits and credits" });
    limits.createEl("p", { text: "Unavailable from the current Nox transports. Token totals are not a quota percentage. For account-specific limits, use Codex /status or AGY /usage in their own CLI; ChatGPT plan limits may be shown in its official account interface." });
  };

  const toolbar = section.createDiv({ cls: "nox-usage-toolbar" });
  new Setting(toolbar).addButton(button => button.setButtonText("Refresh usage").onClick(async () => {
    button.setDisabled(true);
    try {
      snapshot = await host.getTokenUsageSnapshot();
      render();
    } catch {
      body.setText("Unable to read usage history. Check Nox plugin data.");
    } finally { button.setDisabled(false); }
  }));
  body.setText("Loading token usage…");
  void host.getTokenUsageSnapshot().then(data => { snapshot = data; render(); },
    () => { body.setText("Unable to read usage history. Check Nox plugin data."); });
}
