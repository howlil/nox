import assert from "node:assert/strict";
import test from "node:test";
import { ProposalPresenter, type ProposalUiPort } from "../../src/chat/proposal-presenter";
import type { ApplyResult, ChatMessage } from "../../src/types";
import type { ProposedEdit } from "../../src/application/learning-types";

class FakeNode {
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  connected = true;
  disabled = false;
  textContent = "";
  attrs: Record<string,string> = {};
  callbacks = new Map<string, Array<() => void>>();
  constructor(readonly cls = "") {}
  get isConnected(): boolean { return this.connected && (!this.parent || this.parent.isConnected); }
  createDiv(options: {cls?: string; text?: string; attr?: Record<string,string>}={}) {
    return this.createEl("div",options);
  }
  createSpan(options: {cls?: string; text?: string; attr?: Record<string,string>}={}) {
    return this.createEl("span",options);
  }
  createEl(_tag: string, options: {cls?:string; text?:string; attr?:Record<string,string>}={}) {
    const node = new FakeNode(options.cls);
    node.parent = this;
    node.textContent=options.text ?? "";
    node.attrs=options.attr??{};
    this.children.push(node);
    return node;
  }
  addEventListener(name: string, handler: () => void) {
    this.callbacks.set(name,[...(this.callbacks.get(name) ?? []),handler]);
  }
  click(){if(!this.disabled)for(const f of this.callbacks.get("click")??[])f();}
  remove() {if(!this.parent)return;this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;this.connected=false;}
  querySelector(selector: string): FakeNode|null {
    const cls=selector.slice(1);
    for(const child of this.children){if(child.cls.split(" ").includes(cls))return child;const nested=child.querySelector(selector);if(nested)return nested;}
    return null;
  }
}
function edit() {
  return {
    id:"proposal-01",
    proposal: {file:"vault/note.md",original:"before",replacement:"after",reason:"Fix"},
  } as ProposedEdit;
}
function setup(overrides: Partial<ProposalUiPort>={}){
  const root=new FakeNode();
  const events: string[]=[];
  const port: ProposalUiPort = {
    reject:async()=>{events.push("rejected");},
    apply:async()=>({ok:true,statusSync:"success"} as unknown as ApplyResult),
    retryStatus:async()=>({ok:true,statusSync:"success"} as unknown as ApplyResult),
    setState:state=>events.push(state),
    reportError:(_node,message)=>events.push(message),
    scroll:()=>{},
    ...overrides,
  };
  return {root,events,presenter:new ProposalPresenter(root as unknown as HTMLElement,port)};
}
const flush=async()=>{await new Promise<void>(resolve=>setImmediate(resolve));};

test("proposal presenter renders committed statuses without reapplying edits",()=>{
  const {root,presenter}=setup();
  const message={proposal:{file:"vault/note.md",original:"before",replacement:"after"},proposalState:"applied"} as ChatMessage;
  presenter.restore(message);
  assert.ok(root.querySelector(".nox-badge--applied"));
  assert.equal(root.querySelector(".nox-proposal-actions"),null);
});

test("proposal apply only shows committed result after asynchronous success",async()=>{
  let release!: (result:ApplyResult)=>void;
  const pending=new Promise<ApplyResult>(resolve=>{release=resolve;});
  const {root,events,presenter}=setup({apply:()=>pending});
  presenter.append(edit());
  const button=root.querySelector(".nox-btn-apply");
  assert.ok(button);
  button.click();
  assert.equal(root.querySelector(".nox-badge--applied"),null);
  release({ok:true,statusSync:"success"} as unknown as ApplyResult);
  await flush();
  assert.ok(root.querySelector(".nox-badge--applied"));
  assert.ok(events.includes("APPLIED"));
  assert.equal(root.querySelector(".nox-proposal-actions"),null);
});

test("detached proposal refuses to update a remounted conversation after completion",async()=>{
  let release!: (result:ApplyResult)=>void;
  const pending=new Promise<ApplyResult>(resolve=>{release=resolve;});
  const {root,events,presenter}=setup({apply:()=>pending});
  presenter.append(edit());
  root.querySelector(".nox-btn-apply")?.click();
  root.connected=false;
  release({ok:true,statusSync:"success"} as unknown as ApplyResult);
  await flush();
  assert.deepEqual(events,[],"old leaf cannot change the new shell state");
  assert.equal(root.querySelector(".nox-badge--applied"),null);
});
