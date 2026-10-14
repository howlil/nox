import { Setting } from "obsidian";
import {
  creditForModel, type CreditBalance, type CreditBalanceInput, type CreditProvider, type CreditUnit,
} from "./CreditBalanceView";
import { summarizeTokenUsage, type UsageFilters, type UsageViewEntry } from "./TokenUsageStats";

export interface UsageViewSnapshot {
  trackingSince?: string;
  entries: UsageViewEntry[];
}

export interface UsageViewHost {
  getTokenUsageSnapshot(): Promise<UsageViewSnapshot>;
  getTokenUsageError(): string | undefined;
  getCreditBalances(): Promise<CreditBalance[]>;
  saveCreditBalance(input: CreditBalanceInput): Promise<void>;
  removeCreditBalance(provider: CreditProvider, model: string | null): Promise<void>;
}

const format = (value: number): string => value.toLocaleString("en-US");
const providers: CreditProvider[] = ["agy", "codex", "chatgpt"];
const providerLabel = (provider: string): string =>
  provider === "chatgpt" ? "ChatGPT plan" : provider.toUpperCase();
const displayAmount = (value: number, unit: CreditUnit): string =>
  (unit === "usd" ? "$" : "") + format(value) + (unit === "credits" ? " credits" :
    unit === "requests" ? " requests" : "");
const isProvider = (value: string): value is CreditProvider => providers.includes(value as CreditProvider);

export function mountTokenUsageSection(container: HTMLElement, host: UsageViewHost): void {
  const section = container.createDiv({ cls: "nox-usage" });
  const header = section.createDiv({ cls: "nox-usage-header" });
  header.createEl("h3", { text: "Token usage" });
  const toolbar = header.createDiv({ cls: "nox-usage-toolbar" });
  section.createEl("p", {
    cls: "nox-usage-description",
    text: "Recorded NOX requests only. Totals do not represent your provider's remaining quota.",
  });
  const body = section.createDiv();
  let snapshot: UsageViewSnapshot = { entries: [] };
  let balances: CreditBalance[] = [];
  const filters: UsageFilters = { provider: "all", model: "all", range: "all" };
  let saving = false;
  let errorMessage = "";

  const refresh = async () => {
    const [usage, credit] = await Promise.all([
      host.getTokenUsageSnapshot(), host.getCreditBalances(),
    ]);
    snapshot = usage;
    balances = credit;
    render();
  };

  const renderCreditEditor = (
    root: HTMLElement,
    scope: { provider: CreditProvider; model: string | null } | null,
  ) => {
    const editor = root.createDiv({ cls: "nox-credit-editor" });
    editor.createEl("strong", { text: scope ? "Edit manual balance" : "Add manual balance" });
    editor.createEl("p", { cls: "nox-usage-description",
      text: "Manual snapshot only. NOX will not subtract spent tokens or infer provider credits." });

    const existing = scope ? balances.find(b => b.provider === scope.provider && b.model === scope.model) : undefined;
    let provider: CreditProvider = scope?.provider ?? "agy";
    let pool: "shared" | "model" = scope?.model === null ? "shared" : "model";
    let model = scope?.model ?? "";
    let unit: CreditUnit = existing?.unit ?? "credits";
    let limit = existing ? String(existing.limit) : "";
    let remaining = existing ? String(existing.remaining) : "";

    const fields = editor.createDiv({ cls: "nox-credit-fields" });
    const providerSetting = new Setting(fields).setName("Provider").addDropdown(d => {
      for (const p of providers) d.addOption(p, providerLabel(p));
      d.setValue(provider).onChange(v => { if (isProvider(v)) provider = v; });
    });
    const scopeSetting = new Setting(fields).setName("Balance scope").addDropdown(d => d
      .addOption("model", "This model only")
      .addOption("shared", "Shared provider pool")
      .setValue(pool).onChange(v => {
        pool = v === "shared" ? "shared" : "model";
        modelSetting.settingEl.toggleClass("nox-hidden", pool === "shared");
      }));
    const modelSetting = new Setting(fields).setName("Model ID").addText(input => input
      .setPlaceholder("Exact model name / ID")
      .setValue(model).onChange(v => { model = v; }));
    modelSetting.settingEl.toggleClass("nox-hidden", pool === "shared");
    new Setting(fields).setName("Unit").addDropdown(d => d
      .addOption("credits", "Credits")
      .addOption("usd", "USD")
      .addOption("requests", "Requests")
      .setValue(unit).onChange(v => { if (v === "credits" || v === "usd" || v === "requests") unit = v; }));
    new Setting(fields).setName("Total limit").addText(input => input
      .setPlaceholder("e.g. 100").setValue(limit).onChange(v => { limit = v; }));
    new Setting(fields).setName("Remaining").addText(input => input
      .setPlaceholder("e.g. 65").setValue(remaining).onChange(v => { remaining = v; }));
    const message = editor.createEl("p", { cls: "nox-usage-warning nox-hidden" });
    const buttons = editor.createDiv({ cls: "nox-credit-editor-actions" });
    const cancel = buttons.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => editor.remove());
    const save = buttons.createEl("button", { text: "Save balance", attr: { type: "button" } });
    save.addEventListener("click", async () => {
      if (saving) return;
      const normalizedModel = pool === "shared" ? null : model.trim();
      const total = limit.trim() ? Number(limit.trim()) : NaN;
      const left = remaining.trim() ? Number(remaining.trim()) : NaN;
      if (normalizedModel !== null && (!normalizedModel || normalizedModel.length > 128)) {
        message.setText("Enter an exact model ID (1–128 characters).");
        message.removeClass("nox-hidden");
        return;
      }
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(left) ||
          left < 0 || left > total || total > 1_000_000_000_000 ||
          (unit === "requests" && (!Number.isSafeInteger(total) || !Number.isSafeInteger(left)))) {
        message.setText("Set a valid limit and remaining balance (0 to limit). Requests must be whole numbers.");
        message.removeClass("nox-hidden");
        return;
      }
      saving = true;
      save.disabled = true;
      try {
        await host.saveCreditBalance({ provider, model: normalizedModel, unit, limit: total, remaining: left });
        balances = await host.getCreditBalances();
        errorMessage = "";
        render();
      } catch (error) {
        message.setText(error instanceof Error ? error.message : "Could not save manual balance.");
        message.removeClass("nox-hidden");
      } finally { saving = false; save.disabled = false; }
    });
    // Scope and provider of existing snapshots must not be silently reassigned.
    if (scope) {
      providerSetting.setDisabled(true);
      scopeSetting.setDisabled(true);
      modelSetting.setDisabled(true);
    }
    editor.scrollIntoView({ block: "nearest" });
  };

  const render = () => {
    body.empty();
    const controls = body.createDiv({ cls: "nox-usage-filters" });
    const addFilter = (
      name: string, selected: string, options: Array<[string, string]>, change: (value: string) => void,
    ) => new Setting(controls).setName(name).addDropdown(dropdown => {
      for (const [value, label] of options) dropdown.addOption(value, label);
      dropdown.setValue(selected).onChange(change);
    });

    const providerOptions = [...new Set([
      ...snapshot.entries.map(x => x.provider), ...balances.map(x => x.provider),
    ])].sort();
    const modelOptions = [...new Set([
      ...snapshot.entries.filter(x => filters.provider === "all" || x.provider === filters.provider).map(x => x.model),
      ...balances.filter(x => x.model !== null && (filters.provider === "all" || x.provider === filters.provider))
        .map(x => x.model!),
    ])].sort();
    if (filters.provider !== "all" && !providerOptions.includes(filters.provider)) filters.provider = "all";
    if (filters.model !== "all" && !modelOptions.includes(filters.model)) filters.model = "all";

    addFilter("Provider", filters.provider,
      [["all", "All providers"], ...providerOptions.map(p => [p, providerLabel(p)] as [string,string])],
      value => { filters.provider = value; filters.model = "all"; render(); });
    addFilter("Model", filters.model,
      [["all", "All models"], ...modelOptions.map(m => [m,m] as [string,string])],
      value => { filters.model = value; render(); });
    addFilter("Period", filters.range,
      [["all", "All time"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]],
      value => { filters.range = value as UsageFilters["range"]; render(); });

    const { totals, rows } = summarizeTokenUsage(snapshot.entries, filters);
    const overview = body.createDiv({ cls: "nox-usage-overview" });
    const main = overview.createDiv({ cls: "nox-usage-primary" });
    main.createSpan({ cls: "nox-usage-eyebrow", text: "TOTAL RECORDED TOKENS" });
    main.createEl("strong", { cls: "nox-usage-total", text: format(totals.totalTokens) });
    main.createSpan({ cls: "nox-usage-subtitle", text: format(totals.requests) + " recorded requests" });
    const split = totals.inputTokens + totals.outputTokens;
    const portion = split ? Math.min(100, totals.inputTokens / split * 100) : 0;
    const bar = main.createDiv({ cls: "nox-usage-split", attr: {
      role: "img", "aria-label": "Input " + format(totals.inputTokens) + " and output " + format(totals.outputTokens),
    } });
    bar.createDiv({ cls: "nox-usage-split-input" }).style.width = portion + "%";
    bar.createDiv({ cls: "nox-usage-split-output" }).style.width = (split ? 100 - portion : 0) + "%";
    main.createSpan({ cls: "nox-usage-subtitle", text: "Split of input + output tokens" });

    const metrics = overview.createDiv({ cls: "nox-usage-metrics" });
    for (const [label, value] of [
      ["Input", totals.inputTokens], ["Output", totals.outputTokens],
      ["Cached input*", totals.cachedInputTokens], ["Reasoning*", totals.reasoningTokens],
    ] as Array<[string, number]>) {
      const metric = metrics.createDiv({ cls: "nox-usage-metric" });
      metric.createEl("span", { text: label });
      metric.createEl("strong", { text: format(value) });
    }
    body.createEl("p", { cls: "nox-usage-footnote",
      text: "Provider-reported total is shown above. *Cached and reasoning are auxiliary figures, not extra tokens added to total." });
    const coverage = body.createEl("p", { cls: "nox-usage-description" });
    coverage.setText(snapshot.trackingSince
      ? "Tracking since " + new Date(snapshot.trackingSince).toLocaleDateString() +
        " · UTC-day reporting · Recorded requests only."
      : "No token metadata recorded yet. Earlier conversations cannot be reconstructed.");
    if (host.getTokenUsageError()) body.createEl("p", { cls: "nox-usage-warning", text: host.getTokenUsageError() });

    const modelSection = body.createDiv({ cls: "nox-usage-models" });
    const modelHead = modelSection.createDiv({ cls: "nox-usage-section-head" });
    modelHead.createEl("h4", { text: "Breakdown by model" });
    modelHead.createSpan({ cls: "nox-usage-subtitle", text: rows.length + " models" });
    if (!rows.length) modelSection.createEl("p", { cls: "nox-usage-description", text: "No recorded usage matches these filters." });
    else {
      const scroll = modelSection.createDiv({ cls: "nox-usage-table-wrap" });
      const table = scroll.createEl("table", { cls: "nox-usage-table" });
      const head = table.createEl("thead").createEl("tr");
      for (const label of ["Provider / Model", "Traffic", "Requests", "Tokens"]) head.createEl("th", { text: label });
      const tbody = table.createEl("tbody");
      const max = Math.max(1, ...rows.map(x => x.totalTokens));
      for (const row of rows) {
        const tr = tbody.createEl("tr");
        const name = tr.createEl("td");
        name.createSpan({ cls: "nox-usage-model-provider", text: providerLabel(row.provider) });
        name.createSpan({ cls: "nox-usage-model-name", text: row.model });
        const graphic = tr.createEl("td");
        const track = graphic.createDiv({ cls: "nox-usage-model-track" });
        track.createDiv({ cls: "nox-usage-model-fill" }).style.width =
          Math.min(100, row.totalTokens / max * 100) + "%";
        tr.createEl("td", { text: format(row.requests) });
        tr.createEl("td", { text: format(row.totalTokens) });
      }
    }

    const credits = body.createDiv({ cls: "nox-credits" });
    const creditHead = credits.createDiv({ cls: "nox-usage-section-head" });
    creditHead.createEl("h4", { text: "Remaining credits" });
    const add = creditHead.createEl("button", { text: "Add balance", attr: { type: "button" } });
    const creditIntro = credits.createEl("p", { cls: "nox-usage-description",
      text: "Manual snapshots, not live provider balances. Shared pools are repeated for visibility, not counted per model." });
    creditIntro.setAttribute("aria-label", "Manual balance scope information");

    const known = new Map<string, { provider: string; model: string }>();
    for (const entry of snapshot.entries) {
      if (filters.provider !== "all" && filters.provider !== entry.provider) continue;
      if (filters.model !== "all" && filters.model !== entry.model) continue;
      known.set(JSON.stringify([entry.provider, entry.model]), { provider: entry.provider, model: entry.model });
    }
    for (const record of balances) {
      if (filters.provider !== "all" && filters.provider !== record.provider) continue;
      if (record.model !== null && (filters.model === "all" || filters.model === record.model)) {
        known.set(JSON.stringify([record.provider, record.model]), { provider: record.provider, model: record.model });
      } else if (record.model === null && filters.model === "all") {
        // Always render one canonical provider-pool row so shared balances can
        // be removed even when usage records contain several models.
        known.set(JSON.stringify([record.provider, ""]), { provider: record.provider, model: "" });
      }
    }

    const creditRows = [...known.values()].sort((a,b) =>
      a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
    if (!creditRows.length) credits.createEl("p", { cls: "nox-usage-description",
      text: "No model records yet. Add a manual balance to begin." });

    for (const row of creditRows) {
      const el = credits.createDiv({ cls: "nox-credit-row" });
      const title = el.createDiv({ cls: "nox-credit-title" });
      const names = title.createDiv({ cls: "nox-credit-names" });
      names.createEl("strong", { text: row.model || providerLabel(row.provider) + " shared pool" });
      const scope = creditForModel(balances, row.provider, row.model);
      // Pool rows own edits/deletes; model rows may display the same shared
      // value but cannot alter the pool independently.
      names.createSpan({ cls: "nox-usage-subtitle",
        text: providerLabel(row.provider) + (scope ? scope.shared ? " · Shared provider pool · Manual" : " · Model-specific · Manual" : " · Unavailable") });
      const buttons = title.createDiv({ cls: "nox-credit-actions" });
      const edit = buttons.createEl("button", {
        text: scope ? "Edit" : "Set balance", attr: { type: "button" },
      });
      edit.addEventListener("click", () => {
        el.querySelector(".nox-credit-editor")?.remove();
        renderCreditEditor(el, scope ? { provider: scope.balance.provider, model: scope.balance.model }
          : { provider: row.provider as CreditProvider, model: row.model || null });
      });
      if (!scope) {
        el.createEl("p", { cls: "nox-usage-subtitle", text: "Balance unavailable — provider does not report account credits to NOX." });
        continue;
      }
      const { balance } = scope;
      const percent = Math.max(0, Math.min(100, balance.remaining / balance.limit * 100));
      el.createDiv({ cls: "nox-credit-values" }).setText(
        displayAmount(balance.remaining, balance.unit) + " / " + displayAmount(balance.limit, balance.unit) +
        " · " + Math.round(percent) + "% left");
      const progress = el.createDiv({ cls: "nox-credit-progress", attr: {
        role: "progressbar", "aria-label": "Remaining manually reported balance",
        "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(percent)),
      } });
      const fill = progress.createDiv({ cls: "nox-credit-progress-fill" });
      fill.style.width = percent + "%";
      fill.toggleClass("is-low", percent <= 15);
      fill.toggleClass("is-warning", percent > 15 && percent <= 35);
      el.createSpan({ cls: "nox-credit-updated", text: "Manual snapshot · " + new Date(balance.updatedAt).toLocaleString() });
      if (scope.shared && row.model !== "") continue; // Only the canonical pool row deletes shared balances.
      const remove = buttons.createEl("button", { text: "Remove", attr: { type: "button" } });
      remove.addEventListener("click", async () => {
        if (saving) return;
        saving = true;
        try {
          await host.removeCreditBalance(balance.provider, balance.model);
          balances = await host.getCreditBalances();
          render();
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : "Could not remove balance.";
          render();
        } finally { saving = false; }
      });
    }
    if (errorMessage) credits.createEl("p", { cls: "nox-usage-warning", text: errorMessage });
    add.addEventListener("click", () => {
      credits.querySelector(".nox-credit-editor")?.remove();
      renderCreditEditor(credits, null);
    });
  };

  new Setting(toolbar).addButton(button => button.setButtonText("Refresh usage").onClick(async () => {
    button.setDisabled(true);
    try { await refresh(); }
    catch { body.setText("Unable to read usage or manual balances. Check NOX plugin data."); }
    finally { button.setDisabled(false); }
  }));
  body.setText("Loading token usage…");
  void refresh().catch(() => {
    body.setText("Unable to read usage or manual balances. Check NOX plugin data.");
  });
}
