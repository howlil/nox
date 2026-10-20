import assert from "node:assert/strict";
import test from "node:test";
import {
  PromptMenuPresenter, type PromptMenuItem, type PromptMenuPort,
} from "../../src/chat/prompt-menu-presenter";
import { NoxPopoverState } from "../../src/chat/popover";

class FakeEl {
  readonly children: FakeEl[] = [];
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly listeners = new Map<string, Array<() => void>>();
  id = "";
  disabled = false;
  value = "";
  title = "";
  textContent = "";
  constructor(readonly cssClass = "") {
    for (const token of cssClass.split(" ").filter(Boolean)) this.classes.add(token);
  }
  createEl(_tag: string, options: { cls?: string; text?: string; attr?: Record<string,string> } = {}) {
    const child = new FakeEl(options.cls);
    child.textContent = options.text ?? "";
    for (const [name,value] of Object.entries(options.attr ?? {})) child.setAttribute(name,value);
    this.children.push(child);
    return child;
  }
  createDiv(options: { cls?: string; text?: string } = {}) {return this.createEl("div", options);}
  createSpan(options: { cls?: string; text?: string } = {}) {return this.createEl("span", options);}
  empty() {this.children.length = 0;}
  setAttribute(name: string,value: string) {this.attrs.set(name,value);if(name==="id")this.id=value;}
  removeAttribute(name: string) {this.attrs.delete(name);}
  toggleClass(name: string,enabled: boolean) {if(enabled)this.classes.add(name);else this.classes.delete(name);}
  querySelector(_selector: string) {return null;}
  querySelectorAll(selector: string): FakeEl[] {
    const cls = selector.split(/[:.]/).filter(Boolean)[0] ?? "";
    const results: FakeEl[] = [];
    for (const child of this.children) {
      if (child.classes.has(cls) && (!selector.includes(":not(:disabled)") || !child.disabled)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name,[...(this.listeners.get(name) ?? []),listener]);
  }
  click() {for(const listener of this.listeners.get("click") ?? [])listener();}
}
const action = (key: string): PromptMenuItem => ({
  key,name:key,description:"description",icon:"file-text",
  action:{type:"scope",command:"/"+key},
});
function deferred<T>() {
  let resolve!: (data:T)=>void;
  const promise=new Promise<T>(fn=>{resolve=fn;});
  return {promise,resolve};
}
async function withReducedMotion(run:()=>Promise<void>): Promise<void> {
  const old = Object.getOwnPropertyDescriptor(globalThis,"window");
  Object.defineProperty(globalThis,"window",{
    configurable:true,value:{matchMedia:()=>({matches:true})},
  });
  try{await run();}finally{
    if(old)Object.defineProperty(globalThis,"window",old);
    else Reflect.deleteProperty(globalThis,"window");
  }
}
function harness(overrides: Partial<PromptMenuPort> = {}) {
  const input=new FakeEl();
  const menu=new FakeEl();
  const trigger=new FakeEl();
  let cacheCleared=0;
  const picked: string[]=[];
  const port:PromptMenuPort={
    items: async()=>[action("one"),action("two")],
    select: async item=>{picked.push(item.key);},
    invalidate:()=>{cacheCleared++;},
    reportError:()=>{},
    ...overrides,
  };
  const presenter=new PromptMenuPresenter(
    input as unknown as HTMLTextAreaElement, menu as unknown as HTMLElement,
    new NoxPopoverState(menu as unknown as HTMLElement),
    trigger as unknown as HTMLButtonElement,port,
  );
  return {input,menu,trigger,picked,presenter,get cacheCleared(){return cacheCleared;}};
}
const keyEvent=(key:string)=> {
  let prevented=false;
  return {
    key,shiftKey:false,
    preventDefault:()=>{prevented=true;},
    get prevented(){return prevented;},
  };
};

test("keyboard selection, aria state and Escape are owned by the prompt presenter",async()=>{
  await withReducedMotion(async()=>{
    const h=harness();
    h.presenter.openCommand();
    await Promise.resolve();
    assert.equal(h.presenter.kind,"command");
    assert.equal(h.trigger.attrs.get("aria-expanded"),"true");
    assert.equal(h.menu.querySelectorAll(".nox-prompt-menu-row:not(:disabled)").length,2);
    const down=keyEvent("ArrowDown");
    assert.equal(h.presenter.onKey(down as unknown as KeyboardEvent),true);
    assert.equal(down.prevented,true);
    const enter=keyEvent("Enter");
    assert.equal(h.presenter.onKey(enter as unknown as KeyboardEvent),true);
    await Promise.resolve();
    assert.deepEqual(h.picked,["two"]);
    const escape=keyEvent("Escape");
    assert.equal(h.presenter.onKey(escape as unknown as KeyboardEvent),true);
    assert.equal(h.input.attrs.has("aria-activedescendant"),false);
    assert.equal(h.trigger.attrs.get("aria-expanded"),"false");
    assert.equal(h.menu.attrs.get("aria-hidden"),"true");
    h.presenter.dispose();
  });
});

test("stale async menu results do not replace the latest query or survive disposal",async()=>{
  await withReducedMotion(async()=>{
    const old=deferred<PromptMenuItem[]>();
    let call=0;
    const h=harness({items:async()=>++call===1?old.promise:[action("new-result")]});
    h.presenter.openCommand();
    h.input.value="/new";
    h.presenter.onInput();
    await Promise.resolve();
    assert.equal(h.menu.querySelectorAll(".nox-prompt-menu-row:not(:disabled)").length,1);
    old.resolve([action("old-result")]);
    await old.promise;
    await Promise.resolve();
    assert.equal(h.menu.querySelectorAll(".nox-prompt-menu-name")
      .some(c=>c.textContent==="new-result"),true);
    h.presenter.dispose();
    assert.equal(h.menu.children.length,0);
    assert.equal(h.trigger.attrs.get("aria-expanded"),"false");
  });
});

test("unknown slash command cannot fall through to sending; program page stays UI-only",async()=>{
  await withReducedMotion(async()=>{
    const h=harness({items:async (_kind,page)=>page==="actions"
      ? [{key:"programs",name:"Programs",description:"Browse",icon:"book-open",action:{type:"programs"}}]
      : [{key:"back",name:"Back",description:"Return",icon:"arrow-left",action:{type:"menu-back"}}]});
    h.presenter.openCommand();
    await Promise.resolve();
    h.menu.querySelectorAll(".nox-prompt-menu-row:not(:disabled)")[0]?.click();
    await Promise.resolve();
    assert.equal(h.presenter.page,"programs");
    h.menu.querySelectorAll(".nox-prompt-menu-row:not(:disabled)")[0]?.click();
    await Promise.resolve();
    assert.equal(h.presenter.page,"actions");
    assert.deepEqual(h.picked,[]);
    h.presenter.close();

    const empty=harness({items:async()=>[]});
    empty.input.value="/missing";
    empty.presenter.onInput();
    await Promise.resolve();
    const enter=keyEvent("Enter");
    assert.equal(empty.presenter.onKey(enter as unknown as KeyboardEvent),true);
    assert.equal(enter.prevented,true);
    empty.presenter.dispose();
  });
});
