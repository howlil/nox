import { Setting } from "obsidian";
import { summarizeTokenUsage, tokenUsageTimeline, type UsageFilters, type UsageViewEntry } from "./TokenUsageStats";

export interface UsageViewSnapshot {
  trackingSince?: string;
  entries: UsageViewEntry[];
}

export interface TokenUsageHost {
  getTokenUsageSnapshot(): Promise<UsageViewSnapshot>;
  getTokenUsageError(): string | undefined;
}
const format = (n: number): string => n.toLocaleString("en-US");
const providerLabel = (provider: string): string =>
  provider === "chatgpt" ? "ChatGPT plan" : provider.toUpperCase();

/** Token tab owns NOX-recorded usage only. No CLI queries or manual balances. */
export function mountTokenUsageSection(container: HTMLElement, host: TokenUsageHost): () => void {
  const section = container.createDiv({ cls: "nox-usage" });
  const header = section.createDiv({ cls: "nox-usage-header" });
  header.createEl("h3", { text: "Token usage" });
  const toolbar = header.createDiv({ cls: "nox-usage-toolbar" });
  section.createEl("p", { cls: "nox-usage-description",
    text: "Tokens reported by requests recorded through NOX. Not your provider's remaining quota." });
  const body = section.createDiv();
  const filters: UsageFilters = { provider: "all", model: "all", range: "all" };
  let snapshot: UsageViewSnapshot = { entries: [] };
  let refreshing = false;
  let disposed = false;

  const render = () => {
    if (disposed) return;
    body.empty();
    const controls = body.createDiv({ cls: "nox-usage-filters" });
    const addFilter = (label: string, selected: string, values: Array<[string,string]>,
      change: (value: string) => void) =>
      new Setting(controls).setName(label).addDropdown(dropdown => {
        for (const [value, name] of values) dropdown.addOption(value, name);
        dropdown.setValue(selected).onChange(change);
      });
    const providers = [...new Set(snapshot.entries.map(entry => entry.provider))].sort();
    if (filters.provider !== "all" && !providers.includes(filters.provider)) filters.provider = "all";
    const models = [...new Set(snapshot.entries
      .filter(entry => filters.provider === "all" || entry.provider === filters.provider)
      .map(entry => entry.model))].sort();
    if (filters.model !== "all" && !models.includes(filters.model)) filters.model = "all";
    addFilter("Provider",filters.provider,
      [["all","All providers"],...providers.map(p=>[p,providerLabel(p)] as [string,string])],
      value => { filters.provider = value;filters.model="all";render(); });
    addFilter("Model",filters.model,
      [["all","All models"],...models.map(m=>[m,m] as [string,string])],
      value => { filters.model=value;render(); });
    addFilter("Period",filters.range,
      [["all","All time"],["7d","Last 7 days"],["30d","Last 30 days"]],
      value => { filters.range=value as UsageFilters["range"];render(); });

    const { totals, rows } = summarizeTokenUsage(snapshot.entries,filters);
    const overview = body.createDiv({ cls: "nox-usage-overview" });
    const primary = overview.createDiv({ cls: "nox-usage-primary" });
    primary.createSpan({ cls: "nox-usage-eyebrow", text: "TOTAL RECORDED TOKENS" });
    primary.createEl("strong", { cls: "nox-usage-total",text: format(totals.totalTokens) });
    primary.createSpan({ cls: "nox-usage-subtitle",text: format(totals.requests)+" recorded requests" });
    const split = totals.inputTokens+totals.outputTokens;
    const ratio = split ? Math.min(100,totals.inputTokens/split*100):0;
    const bar = primary.createDiv({ cls: "nox-usage-split",attr:{
      role:"img","aria-label":"Input "+format(totals.inputTokens)+" and output "+format(totals.outputTokens),
    } });
    bar.createDiv({cls:"nox-usage-split-input"}).style.width=ratio+"%";
    bar.createDiv({cls:"nox-usage-split-output"}).style.width=(split?100-ratio:0)+"%";
    primary.createSpan({cls:"nox-usage-subtitle",text:"Input / Output"});
    const metrics=overview.createDiv({cls:"nox-usage-metrics"});
    for(const [name,value] of [
      ["Input",totals.inputTokens],["Output",totals.outputTokens],
      ["Cached input*",totals.cachedInputTokens],["Reasoning*",totals.reasoningTokens],
    ] as Array<[string,number]>) {
      const row=metrics.createDiv({cls:"nox-usage-metric"});
      row.createEl("span",{text:name});
      row.createEl("strong",{text:format(value)});
    }
    const timeline = tokenUsageTimeline(snapshot.entries, filters);
    const hasTraffic = timeline.some(day => day.inputTokens + day.outputTokens > 0);
    if (hasTraffic) {
      const chart = body.createDiv({ cls: "nox-token-chart" });
      const heading = chart.createDiv({ cls: "nox-usage-section-head" });
      heading.createEl("h4", { text: "Token activity" });
      heading.createSpan({ cls: "nox-usage-subtitle",
        text: filters.range === "7d" ? "Last 7 days · UTC" :
          filters.range === "30d" ? "Last 30 days · 3-day groups · UTC" :
          "Most recent 14 tracked days · UTC" });
      const bars = chart.createDiv({ cls: "nox-token-chart-bars", attr: {
        role: "group", "aria-label": "Recorded input and output token activity by UTC date",
      } });
      bars.setCssProps({ "--nox-chart-count": String(timeline.length) });
      const max = Math.max(1, ...timeline.map(day => day.inputTokens + day.outputTokens));
      for (const day of timeline) {
        const total = day.inputTokens + day.outputTokens;
        const column = bars.createDiv({ cls: "nox-token-chart-column",
          attr: { role: "img", "aria-label": day.startDate +
            (day.endDate !== day.startDate ? " to " + day.endDate : "") +
            ": Input " + format(day.inputTokens) + ", output " + format(day.outputTokens) },
        });
        const stack = column.createDiv({ cls: "nox-token-chart-stack" });
        stack.setCssProps({
          "--nox-chart-input": (day.inputTokens / max * 100).toFixed(2) + "%",
          "--nox-chart-output": (day.outputTokens / max * 100).toFixed(2) + "%",
        });
        stack.createDiv({ cls: "nox-token-chart-output" });
        stack.createDiv({ cls: "nox-token-chart-input" });
        column.createSpan({ cls: "nox-token-chart-date",
          text: new Date(day.startDate + "T00:00:00Z").toLocaleDateString("en-US", {
            timeZone: "UTC", month: "short", day: "numeric",
          }) });
      }
      const legend = chart.createDiv({ cls: "nox-token-chart-legend" });
      legend.createSpan({ cls: "nox-token-chart-legend-input", text: "Input" });
      legend.createSpan({ cls: "nox-token-chart-legend-output", text: "Output" });
    }
    body.createEl("p",{cls:"nox-usage-footnote",
      text:"* Cached and reasoning are auxiliary reported figures; do not add them to total tokens."});
    body.createEl("p",{cls:"nox-usage-description",text:snapshot.trackingSince
      ?"Tracking since "+new Date(snapshot.trackingSince).toLocaleDateString()+
        " · UTC-day reporting · Recorded requests only."
      :"No token usage recorded yet. Older conversations cannot be reconstructed."});
    if(host.getTokenUsageError()) body.createEl("p",{cls:"nox-usage-warning",text:host.getTokenUsageError()});

    const modelsSection=body.createDiv({cls:"nox-usage-models"});
    const mh=modelsSection.createDiv({cls:"nox-usage-section-head"});
    mh.createEl("h4",{text:"Breakdown by model"});
    mh.createSpan({cls:"nox-usage-subtitle",text:rows.length+" models"});
    if(!rows.length) {
      modelsSection.createEl("p",{cls:"nox-usage-description",text:"No recorded usage matches these filters."});
    } else {
      const scroll=modelsSection.createDiv({cls:"nox-usage-table-wrap"});
      const table=scroll.createEl("table",{cls:"nox-usage-table"});
      const head=table.createEl("thead").createEl("tr");
      for(const label of ["Provider / Model","Traffic","Requests","Tokens"]) head.createEl("th",{text:label});
      const tbody=table.createEl("tbody");
      const max=Math.max(1,...rows.map(x=>x.totalTokens));
      for(const item of rows) {
        const tr=tbody.createEl("tr");
        const name=tr.createEl("td");
        name.createSpan({cls:"nox-usage-model-provider",text:providerLabel(item.provider)});
        name.createSpan({cls:"nox-usage-model-name",text:item.model});
        const barCell=tr.createEl("td");
        const track=barCell.createDiv({cls:"nox-usage-model-track"});
        track.createDiv({cls:"nox-usage-model-fill"}).style.width=
          Math.min(100,item.totalTokens/max*100)+"%";
        tr.createEl("td",{text:format(item.requests)});
        tr.createEl("td",{text:format(item.totalTokens)});
      }
    }
  };

  const refresh=async()=>{
    if(refreshing || disposed) return;
    refreshing=true;
    try {
      snapshot=await host.getTokenUsageSnapshot();
      render();
    } catch {
      if(!disposed) body.setText("Unable to read token usage. Check NOX plugin data.");
    } finally { refreshing=false; }
  };
  new Setting(toolbar).addButton(btn=>btn.setButtonText("Refresh usage").onClick(async()=>{
    btn.setDisabled(true);
    try { await refresh(); }
    finally { if (!disposed) btn.setDisabled(false); }
  }));
  body.setText("Loading token usage…");
  void refresh();

  return () => { disposed=true; };
}
