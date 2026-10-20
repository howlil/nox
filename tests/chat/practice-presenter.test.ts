import assert from "node:assert/strict";
import test from "node:test";
import type { ChatSession } from "../../src/types";
import { PracticePresenter, type PracticeUiCallbacks } from "../../src/features/practice/view/PracticePresenter";
import type { PracticeQuestion, PracticeAnswer } from "../../src/domain/practice/types";

class FakeEl {
  readonly children: FakeEl[] = [];
  private readonly events = new Map<string, Array<() => void>>();
  value = "";
  disabled = false;
  hidden = false;
  textContent = "";
  placeholder = "";
  rows = 0;
  constructor(readonly tag: string, readonly cssClass = "") {}
  createEl(tag: string, options: {cls?: string; text?: string; attr?: Record<string,string>} = {}) {
    const el = new FakeEl(tag,options.cls ?? "");
    el.textContent = options.text ?? "";
    this.children.push(el);
    return el;
  }
  createDiv(options: {cls?: string; text?: string} = {}) {return this.createEl("div",options);}
  createSpan(options: {cls?: string; text?: string} = {}) {return this.createEl("span",options);}
  setAttribute(_name: string,_value: string) {}
  setText(value: string) {this.textContent=value;}
  toggleClass(_name: string,_active: boolean) {}
  addEventListener(name: string, listener: () => void) {
    this.events.set(name,[...(this.events.get(name) ?? []),listener]);
  }
  fire(name: string) {for(const listener of this.events.get(name) ?? []) listener();}
  find(cssClass: string): FakeEl | undefined {
    if(this.cssClass.split(" ").includes(cssClass))return this;
    for(const child of this.children){const found=child.find(cssClass);if(found)return found;}
    return undefined;
  }
}

const question: PracticeQuestion = {
  kind:"question", concept:"Promises", question:"Explain async ordering.",
  input: {type:"essay"},
};
function makeSession(id="old"): ChatSession {
  return {id,messages:[{
    id:"a1",role:"assistant",content:"",parts:[{type:"practice-question",questionId:"q1",question}],
  }]} as unknown as ChatSession;
}
function makeActions(saveDraft: PracticeUiCallbacks["saveDraft"]) {
  let session=makeSession();
  const callbacks: PracticeUiCallbacks={
    session:()=>session,hasActiveQuestion:()=>true,isBusy:()=>false,
    saveDraft,
    requestHint:async()=>true,submit:async()=>true,clarify:()=>{},
    prepareContinue:()=>{},reportError:()=>{},
  };
  return {callbacks,changeSession:(id:string)=>{session=makeSession(id);}};
}
async function withPendingTimer(run: () => Promise<void>) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,"window");
  const cancelled:number[]=[];
  Object.defineProperty(globalThis,"window", {configurable:true,value:{
    setTimeout:(_callback:()=>void,_delay:number)=>77,
    clearTimeout:(id:number)=>{cancelled.push(id);},
  }});
  try{await run();}finally{
    if(previous)Object.defineProperty(globalThis,"window",previous);
    else Reflect.deleteProperty(globalThis,"window");
  }
  return cancelled;
}

test("pending essay draft is committed once before navigation invalidates the presenter",async()=>{
  const saved:Array<{questionId:string;answer:PracticeAnswer;sessionId:string}>=[];
  const actions=makeActions(async(questionId,answer,sessionId)=>{
    saved.push({questionId,answer,sessionId});
  });
  await withPendingTimer(async()=>{
    const presenter=new PracticePresenter(actions.callbacks);
    const root=new FakeEl("div");
    presenter.renderQuestion(root as unknown as HTMLElement,question,"q1");
    const editor=root.find("nox-quiz-editor");
    assert.ok(editor);
    editor.value="Awaited values settle later";
    editor.fire("input");
    await presenter.flushDraft();
    assert.deepEqual(saved,[{questionId:"q1",answer:{type:"essay",text:"Awaited values settle later"},sessionId:"old"}]);
    actions.changeSession("new");
    presenter.reset();
    await presenter.flushDraft();
    assert.equal(saved.length,1);
    presenter.dispose();
  });
});

test("failed pending draft save remains retryable and is not written into a different session",async()=>{
  let attempts=0;
  const actions=makeActions(async()=>{
    attempts++;
    if(attempts===1)throw new Error("Disk unavailable");
  });
  await withPendingTimer(async()=>{
    const presenter=new PracticePresenter(actions.callbacks);
    const root=new FakeEl("div");
    presenter.renderQuestion(root as unknown as HTMLElement,question,"q1");
    const editor=root.find("nox-quiz-editor");
    assert.ok(editor);
    editor.value="Retry draft";
    editor.fire("input");
    await assert.rejects(presenter.flushDraft(),/Disk unavailable/);
    await presenter.flushDraft();
    assert.equal(attempts,2);
    editor.value="Another local draft";
    editor.fire("input");
    actions.changeSession("new");
    presenter.reset();
    await presenter.flushDraft();
    assert.equal(attempts,2);
    presenter.dispose();
  });
});
