import { Setting } from "obsidian";

/** Settings-side projection of provider quota facts; no adapter dependencies. */
export interface QuotaViewReading {
  provider: "agy" | "codex";
  key: string;
  label: string;
  kind: "window" | "credit";
  remainingPercent?: number;
  amount?: string;
  resetAt?: string;
  model?: string;
  shared: boolean;
}
export interface QuotaViewSnapshot {
  provider: "agy" | "codex";
  status: "live" | "stale" | "unavailable";
  checkedAt?: string;
  readings: QuotaViewReading[];
  error?: string;
}
export interface ProviderUsageHost {
  getProviderQuotas(force?: boolean): Promise<QuotaViewSnapshot[]>;
}
type QuotaProviderFilter = "all" | "agy" | "codex" | "chatgpt";
const providerLabel = (provider:string) =>
  provider === "agy" ? "AGY" : provider === "codex" ? "Codex" : "ChatGPT plan";

export function mountProviderUsageSection(container:HTMLElement,host:ProviderUsageHost):()=>void {
  const section=container.createDiv({cls:"nox-usage nox-provider-usage"});
  const header=section.createDiv({cls:"nox-usage-header"});
  header.createEl("h3",{text:"Provider usage"});
  const toolbar=header.createDiv({cls:"nox-usage-toolbar"});
  section.createEl("p",{cls:"nox-usage-description",
    text:"Remaining quotas reported by AGY and Codex CLIs. Shared windows are not independent model credits."});
  const body=section.createDiv();
  let filter:QuotaProviderFilter="all";
  let snapshots:QuotaViewSnapshot[]=[];
  let loading=false;
  let started=false;
  let disposed=false;

  const render=()=>{
    if(disposed)return;
    body.empty();
    const controls=body.createDiv({cls:"nox-usage-filters nox-provider-filter"});
    new Setting(controls).setName("Provider").addDropdown(dropdown=>dropdown
      .addOption("all","All providers")
      .addOption("agy","AGY").addOption("codex","Codex")
      .addOption("chatgpt","ChatGPT plan")
      .setValue(filter).onChange(v=>{filter=v as QuotaProviderFilter;render();}));
    if(loading) body.createEl("p",{cls:"nox-usage-description",
      text:"Checking local providers… This does not start an AI turn."});

    for(const provider of ["agy","codex"] as const) {
      if(filter!=="all"&&filter!==provider)continue;
      const snapshot=snapshots.find(s=>s.provider===provider);
      const group=body.createDiv({cls:"nox-provider-quota-group", attr:{
        "data-nox-quota-status":snapshot?.status ?? (loading?"checking":"unavailable"),
      }});
      const label=group.createDiv({cls:"nox-provider-quota-label"});
      label.createEl("strong",{text:providerLabel(provider)});
      label.createSpan({cls:"nox-usage-subtitle",
        text: snapshot?.status==="live"?"Provider-reported" :
          snapshot?.status==="stale"?"Stale · Last successful reading":
          loading?"Checking…":"Unavailable"});
      if(!snapshot||snapshot.status==="unavailable") {
        group.createEl("p",{cls:"nox-usage-subtitle",text:snapshot?.error ||
          (loading?"Checking provider…":"No supported provider quota snapshot.")});
        continue;
      }
      if(snapshot.checkedAt && Number.isFinite(Date.parse(snapshot.checkedAt))) group.createSpan({cls:"nox-quota-updated",
        text:"Last checked "+new Date(snapshot.checkedAt).toLocaleString()});
      if(snapshot.error) group.createEl("p",{cls:"nox-usage-subtitle",text:snapshot.error});
      if(!snapshot.readings.length) group.createEl("p",{cls:"nox-usage-description",
        text:"Provider returned no quota windows."});
      for(const reading of snapshot.readings) {
        const row=group.createDiv({cls:"nox-provider-quota-row"});
        const title=row.createDiv({cls:"nox-quota-title"});
        const copy=title.createDiv({cls:"nox-quota-names"});
        copy.createEl("strong",{text:reading.label});
        copy.createSpan({cls:"nox-usage-subtitle",
          text:reading.model ? "Model-specific: "+reading.model : "Shared pool / window"});
        if(reading.remainingPercent!==undefined && Number.isFinite(reading.remainingPercent)) {
          const value=Math.max(0,Math.min(100,reading.remainingPercent));
          title.createEl("strong",{cls:"nox-provider-quota-percent",
            text:Math.floor(value)+"% left"});
          const progress=row.createDiv({cls:"nox-quota-progress",attr:{
            role:"progressbar","aria-label":reading.label+" remaining",
            "aria-valuemin":"0","aria-valuemax":"100",
            "aria-valuenow":String(Math.floor(value)),
          }});
          const fill=progress.createDiv({cls:"nox-quota-progress-fill"});
          fill.style.width=value+"%";
          fill.toggleClass("is-low",value<=15);
          fill.toggleClass("is-warning",value>15&&value<=35);
        }
        if(reading.amount!==undefined)row.createEl("p",{cls:"nox-quota-values",
          text:"Provider-reported balance: "+reading.amount});
        if(reading.resetAt && Number.isFinite(Date.parse(reading.resetAt)))row.createSpan({cls:"nox-quota-updated",
          text:"Resets "+new Date(reading.resetAt).toLocaleString()});
      }
    }
    if(filter==="all"||filter==="chatgpt") {
      const chat=body.createDiv({cls:"nox-provider-quota-group"});
      chat.createEl("strong",{text:"ChatGPT plan"});
      chat.createEl("p",{cls:"nox-usage-subtitle",
        text:"Live per-model plan limits are unavailable through the NOX ChatGPT adapter."});
    }
  };

  const refresh=async(force=false)=>{
    if(disposed||loading)return;
    loading=true;started=true;render();
    try {
      snapshots=await host.getProviderQuotas(force);
    } catch {
      snapshots=[
        {provider:"agy",status:"unavailable",readings:[],error:"AGY quota retrieval failed."},
        {provider:"codex",status:"unavailable",readings:[],error:"Codex quota retrieval failed."},
      ];
    } finally { loading=false;render(); }
  };
  new Setting(toolbar).addButton(button=>button.setButtonText("Refresh credits")
    .onClick(async()=>{
      button.setDisabled(true);
      try {await refresh(true);}
      finally {if(!disposed)button.setDisabled(false);}
    }));
  body.setText("Loading provider quotas…");
  if(!started)void refresh();

  return ()=>{disposed=true;};
}
