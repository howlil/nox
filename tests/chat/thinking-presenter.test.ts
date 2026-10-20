import assert from "node:assert/strict";
import test from "node:test";
import { ThinkingPresenter } from "../../src/chat/thinking-presenter";
import type { ChatMessage } from "../../src/types";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classes = new Set<string>();
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string,string> = {};
  readonly listeners = new Map<string, (()=>void)[]>();
  textContent = "";
  scrollTop = 0;
  scrollHeight = 800;
  id = "";
  isConnected = true;
  constructor(readonly tag = "div", cls = "") {
    for (const token of cls.split(" ").filter(Boolean)) this.classes.add(token);
  }
  createEl(tag:string, options:{cls?:string;text?:string;attr?:Record<string,string>} = {}) {
    const e = new FakeElement(tag, options.cls);
    e.textContent = options.text ?? "";
    for(const [name,value] of Object.entries(options.attr ?? {})) e.setAttribute(name,value);
    this.children.push(e);
    return e;
  }
  createDiv(options:{cls?:string;text?:string} = {}) {return this.createEl("div",options);}
  createSpan(options:{cls?:string;text?:string} = {}) {return this.createEl("span",options);}
  setAttribute(name:string,value:string) {this.attributes.set(name,value);if(name==="id")this.id=value;}
  removeAttribute(name:string) {this.attributes.delete(name);}
  addClass(...names:string[]) {for(const name of names)this.classes.add(name);}
  removeClass(...names:string[]) {for(const name of names)this.classes.delete(name);}
  hasClass(name:string) {return this.classes.has(name);}
  toggleClass(name:string,on:boolean) {if(on)this.classes.add(name);else this.classes.delete(name);}
  empty() {this.children.length=0;}
  setText(text:string) {this.textContent=text;}
  get lastElementChild(): FakeElement | null {return this.children[this.children.length-1] ?? null;}
  addEventListener(name:string,cb:()=>void) {
    this.listeners.set(name,[...(this.listeners.get(name)??[]),cb]);
  }
  click() {for (const cb of this.listeners.get("click")??[])cb();}
  querySelector<T>(_query:string): T | null {
    const query=_query as string;
    const cls=query.startsWith(".")?query.slice(1):"";
    for(const child of this.children) {
      if(cls && child.classes.has(cls))return child as T;
      const nested=child.querySelector<T>(query);
      if(nested)return nested;
    }
    return null;
  }
  querySelectorAll(query:string): FakeElement[] {
    const cls=query.startsWith(".")?query.slice(1):"";
    const matches:FakeElement[]=[];
    for(const child of this.children) {
      if(cls && child.classes.has(cls))matches.push(child);
      matches.push(...child.querySelectorAll(query));
    }
    return matches;
  }
}

async function withFakeWindow(run:(api:{active:()=>number;tick:()=>void})=>Promise<void>) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,"window");
  const active=new Map<number,()=>void>();
  let next=0;
  Object.defineProperty(globalThis,"window",{configurable:true,value:{
    setInterval:(fn:()=>void)=>{const id=++next;active.set(id,fn);return id;},
    clearInterval:(id:number)=>{active.delete(id);},
    requestAnimationFrame:(fn:()=>void)=>{fn();return 1;},
    matchMedia:()=>({matches:true}),
  }});
  try {
    await run({active:()=>active.size,tick:()=>{for(const cb of active.values())cb();}});
  } finally {
    if(previous)Object.defineProperty(globalThis,"window",previous);
    else Reflect.deleteProperty(globalThis,"window");
  }
}

const presenter=(root:FakeElement)=>new ThinkingPresenter(
  root as unknown as HTMLElement,
  ()=>"app://nox-logo",
  action=>action === "practice" ? "Practice" : "Ask",
);

test("thinking tracks only observed phases, tool completion and terminal statuses",async()=>{
  await withFakeWindow(async win=>{
    const root=new FakeElement();
    const ui=presenter(root);
    ui.begin("practice");
    assert.equal(win.active(),1);
    ui.stage(3);
    const rows=root.querySelectorAll(".nox-thinking-row");
    assert.equal(rows.length,2); // phase 0 and observed phase 3, no fabricated phases 1 or 2
    assert.equal(rows[1].querySelector<FakeElement>(".nox-thinking-primary")?.textContent,
      "Receiving model output");
    ui.toolCompleted("missing","completed");
    assert.equal(root.querySelectorAll(".nox-thinking-tool").length,0);
    ui.toolStarted("id1","Search");
    ui.toolStarted("id2","Read");
    ui.toolCompleted("id1","completed");
    ui.settleInspector("failed");
    ui.finish("Unable to finish");
    assert.equal(win.active(),0);
    assert.equal(root.querySelector<FakeElement>(".nox-thinking-label")?.textContent,"Unable to finish");
    const tools=root.querySelectorAll(".nox-thinking-tool");
    assert.equal(tools[0].dataset.status,"completed");
    assert.equal(tools[1].dataset.status,"interrupted");
    const trace=root.querySelector<FakeElement>(".nox-thinking");
    assert.equal(trace?.hasClass("nox-thinking--settled"),true);
    assert.equal(root.querySelector<FakeElement>(".nox-thinking-panel")?.hasClass("is-expanded"),false);
    const traceCount=root.querySelectorAll(".nox-thinking").length;
    ui.thoughtDelta("late thought after terminal");
    ui.stage(4);
    ui.toolStarted("late","Should not render");
    assert.equal(root.querySelectorAll(".nox-thinking").length,traceCount);
    assert.equal(root.querySelectorAll(".nox-thinking-tool").length,2);
    ui.dispose();
  });
});

test("reset and disposal prevent duplicate timers; restored trace starts collapsed",async()=>{
  await withFakeWindow(async win=>{
    const root=new FakeElement();
    const ui=presenter(root);
    ui.begin("ask");
    assert.equal(win.active(),1);
    ui.begin("practice");
    assert.equal(win.active(),1);
    ui.reset();
    assert.equal(win.active(),0);
    ui.thoughtDelta("orphan thought after cancel");
    assert.equal(root.querySelectorAll(".nox-thinking").length,2);
    const msg={
      role:"assistant",action:"practice",content:"response",elapsedMs:2200,
      thought:"Optional model trace",sourcePath:"learn.md",
    } as ChatMessage;
    const restored=ui.appendRestoredThinkingTrace(msg) as unknown as FakeElement;
    const panel=restored.querySelector<FakeElement>(".nox-thinking-panel");
    const toggle=restored.querySelector<FakeElement>(".nox-thinking-toggle");
    assert.equal(panel?.hasClass("is-expanded"),false);
    assert.equal(toggle?.attributes.get("aria-expanded"),"false");
    assert.equal(restored.querySelector<FakeElement>(".nox-thinking-thought")?.textContent,"Optional model trace");
    toggle?.click();
    assert.equal(panel?.hasClass("is-expanded"),true);
    assert.equal(toggle?.attributes.get("aria-expanded"),"true");
    ui.dispose();
    assert.equal(win.active(),0);
  });
});
