import assert from "node:assert/strict";
import test from "node:test";
import { ModelMenuPresenter, modelMenuItems, type ModelMenuPort } from "../../src/chat/model-menu";
import { NoxPopoverState } from "../../src/chat/popover";

test("empty provider catalog offers only runtime default unless a manual model is selected", () => {
  assert.deepEqual(modelMenuItems([]), [{ id: "", name: "Runtime default" }]);
  assert.deepEqual(modelMenuItems([], "custom-codex-model"), [
    { id: "", name: "Runtime default" }, { id: "custom-codex-model", name: "custom-codex-model" },
  ]);
});

test("discovered model retains its display name without a duplicate manual option", () => {
  assert.deepEqual(modelMenuItems([{ id: "model-a", name: "Model A" }], "model-a"), [
    { id: "", name: "Runtime default" }, { id: "model-a", name: "Model A" },
  ]);
});


/** Obsidian's DOM extension subset exercised by the model-picker presentation contract. */
function fakeDom() {
  class ElementStub {
    id = "";
    disabled = false;
    textContent = "";
    title = "";
    readonly children: ElementStub[] = [];
    readonly classes = new Set<string>();
    readonly attrs = new Map<string, string>();
    readonly listeners = new Map<string, (() => void)[]>();
    focused = false;
    constructor(readonly className = "") {
      for (const cls of className.split(" ").filter(Boolean)) this.classes.add(cls);
    }
    createEl(_tag: string, options: { cls?: string; text?: string; attr?: Record<string,string> } = {}) {
      const child = new ElementStub(options.cls);
      if (options.text) child.textContent = options.text;
      for (const [name,value] of Object.entries(options.attr ?? {})) child.setAttribute(name,value);
      this.children.push(child);
      return child;
    }
    createSpan(options: { cls?: string; text?: string } = {}) { return this.createEl("span", options); }
    createDiv(options: { cls?: string; text?: string } = {}) { return this.createEl("div", options); }
    empty() { this.children.length = 0; }
    hasChildNodes() { return this.children.length > 0; }
    setAttribute(name: string,value: string) { this.attrs.set(name,value); if(name==="id")this.id=value; }
    removeAttribute(name: string) { this.attrs.delete(name); }
    toggleClass(name: string, enabled: boolean) { if(enabled)this.classes.add(name);else this.classes.delete(name); }
    querySelector(query: string) { return this.querySelectorAll(query)[0] ?? null; }
    querySelectorAll(query: string): ElementStub[] {
      const found: ElementStub[] = [];
      const cls = query.startsWith(".") ? query.slice(1) : "";
      for (const child of this.children) {
        if (cls && child.classes.has(cls)) found.push(child);
        found.push(...child.querySelectorAll(query));
      }
      return found;
    }
    addEventListener(event: string, handler: () => void) {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(handler);
      this.listeners.set(event, listeners);
    }
    click() { for (const cb of this.listeners.get("click") ?? []) cb(); }
    focus() { this.focused = true; }
  }
  const trigger = new ElementStub();
  const menu = new ElementStub();
  return { trigger, menu, ElementStub };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function withReducedMotion(run: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true, value: { matchMedia: () => ({ matches: true }) },
  });
  try { await run(); } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("model picker keyboard Escape closes the focus-owning popover and restores trigger focus", async () => {
  await withReducedMotion(async () => {
    const {trigger,menu}=fakeDom();
    let label = "";
    const presenter = new ModelMenuPresenter(
      trigger as unknown as HTMLButtonElement,menu as unknown as HTMLElement,
      new NoxPopoverState(menu as unknown as HTMLElement),{
        models: () => [{id:"gpt-example",name:"Example"}],
        selectedId: () => undefined,
        discoveryError: () => undefined,
        discover: async () => {},
        select: async () => {},
        setLabel: value => { label = value; },
        beforeOpen: () => {},
        reportError: () => {},
      });
    assert.equal(label, "Runtime default");
    presenter.open();
    assert.equal(presenter.isOpen, true);
    assert.equal(trigger.attrs.get("aria-expanded"), "true");
    assert.equal(menu.querySelectorAll(".nox-model-menu-row").length, 2);
    let prevented = false;
    presenter.onTriggerKey({key:"Escape",preventDefault:()=>{prevented=true;}} as KeyboardEvent);
    assert.equal(prevented, true);
    assert.equal(presenter.isOpen, false);
    assert.equal(trigger.attrs.get("aria-expanded"), "false");
    assert.equal(trigger.focused, true);
    presenter.dispose();
  });
});

test("async discovery resolving after disposal cannot reopen or touch detached model UI", async () => {
  await withReducedMotion(async () => {
    const {trigger,menu}=fakeDom();
    const pending=deferred();
    let discoverCount=0;
    let updateCount=0;
    const port: ModelMenuPort={
      models:()=>[],selectedId:()=>undefined,discoveryError:()=>undefined,
      discover:()=>{discoverCount++;return pending.promise;},
      select:async()=>{},setLabel:()=>{updateCount++;},beforeOpen:()=>{},reportError:()=>{},
    };
    const presenter=new ModelMenuPresenter(
      trigger as unknown as HTMLButtonElement,menu as unknown as HTMLElement,
      new NoxPopoverState(menu as unknown as HTMLElement),port);
    presenter.open();
    assert.equal(discoverCount,1);
    assert.equal(presenter.isOpen,true);
    presenter.dispose();
    const after=updateCount;
    pending.resolve();
    await pending.promise;
    await Promise.resolve();
    assert.equal(updateCount,after);
    assert.equal(menu.children.length,0);
    assert.equal(trigger.attrs.get("aria-expanded"),"false");
    assert.equal(presenter.isOpen,false);
  });
});
