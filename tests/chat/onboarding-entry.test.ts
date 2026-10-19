import assert from "node:assert/strict";
import test from "node:test";
import { OnboardingFlow } from "../../src/chat/onboarding-flow";
import type { LearningController } from "../../src/application/LearningController";

class FakeElement {
  children: FakeElement[] = [];
  handlers = new Map<string, () => void>();
  isConnected = true;
  disabled = false;
  value = "";
  focused = false;
  attributes = new Map<string, string>();
  constructor(readonly tag = "div", readonly cls = "", readonly text = "") {}
  createEl(tag: string, opts: { cls?: string; text?: string } = {}): FakeElement {
    const child = new FakeElement(tag, opts.cls ?? "", opts.text ?? "");
    this.children.push(child);
    return child;
  }
  createDiv(opts: { cls?: string; text?: string } = {}): FakeElement {
    return this.createEl("div", opts);
  }
  createSpan(opts: { cls?: string; text?: string } = {}): FakeElement {
    return this.createEl("span", opts);
  }
  empty(): void { this.children = []; }
  addClass(_cls: string): void {}
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  toggleClass(_cls: string, _on: boolean): void {}
  addEventListener(name: string, handler: () => void): void { this.handlers.set(name, handler); }
  click(): void { if (!this.disabled) this.handlers.get("click")?.(); }
  input(value: string): void { this.value = value; this.handlers.get("input")?.(); }
  focus(): void { this.focused = true; }
  querySelector<T>(_selector: string): T | null {
    const cls = _selector.startsWith(".") ? _selector.slice(1) : "";
    const found = this.findAll().find(el =>
      cls ? el.cls.split(" ").includes(cls) : el.tag === _selector);
    return (found ?? null) as T | null;
  }
  findAll(): FakeElement[] { return this.children.flatMap(el => [el, ...el.findAll()]); }
  buttons(label: string): FakeElement[] {
    return this.findAll().filter(el => el.tag === "button" &&
      (el.text === label || el.findAll().some(child => child.text === label)));
  }
}
const dom = (v: FakeElement) => v as unknown as HTMLElement;
(globalThis as { window?: unknown }).window = {
  matchMedia: () => ({ matches: true }),
};

function setup() {
  const root = new FakeElement();
  let activeNote: string | undefined = "notes/Book.md";
  let health: "ready" | "offline" = "ready";
  let probes = 0;
  let reads = 0;
  const sent: string[] = [];
  const drafts: string[] = [];
  const learning = {
    getOnboardingContext: async () => { reads++; return {
      hasProgram: false, dismissed: false, activeNote,
    }; },
    checkRuntime: async () => { probes++; return health === "ready"
      ? { status: "ready" } : { status: "failed", failure: { message: "Offline" } }; },
    saveOnboardingDraft: async (draft: { stage: string }) => { drafts.push(draft.stage); },
  } as unknown as LearningController;
  const callbacks = {
    onSkip: () => { sent.push("chat"); },
    onCreated: () => { sent.push("created"); },
    onStart: () => { sent.push("start"); },
    onQuickPlan: async (command: string) => { sent.push(command); },
    onNoteAction: async (path: string, kind: "explain" | "practice") => {
      sent.push(kind + ":" + path);
    },
  };
  new OnboardingFlow(dom(root), learning, callbacks);
  return {
    root, sent, drafts,
    get reads() { return reads; },
    get probes() { return probes; },
    setNote(value: string | undefined) { activeNote = value; },
    setHealth(value: "ready" | "offline") { health = value; },
  };
}
const flush = async () => {
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
};

test("M2 welcome exposes exactly Note / Goal / Chat (no discovery wizard)", () => {
  const x = setup();
  const cards = x.root.findAll().filter(el => el.cls === "nox-onboarding-card");
  assert.deepEqual(cards.map(card => card.findAll().find(el =>
    el.cls === "nox-onboarding-name")?.text),
  ["Learn from a note", "Start with a goal", "Just chat"]);
  x.root.buttons("Just chat")[0].click();
  assert.deepEqual(x.sent, ["chat"]);
  assert.equal(x.probes, 0);
});

test("M2 quick goal dispatches the existing /plan command, no workspace approval", async () => {
  const x = setup();
  x.root.buttons("Start with a goal")[0].click();
  const input = x.root.querySelector<FakeElement>(".nox-onboarding-field");
  assert.ok(input);
  input.input("  Learn   distributed systems  ");
  x.root.buttons("Create quick plan")[0].click();
  await flush();
  assert.deepEqual(x.sent, ["/plan Learn distributed systems"]);
  assert.equal(x.probes, 1);
  assert.equal(x.reads, 0, "general goal never preloads a note");
});

test("M2 note practice binds chosen path, not curriculum, and checks active note", async () => {
  const x = setup();
  x.root.buttons("Learn from a note")[0].click();
  await flush();
  assert.equal(x.root.buttons("Explain this note").length, 1);
  x.root.buttons("Practice this note")[0].click();
  await flush();
  assert.deepEqual(x.sent, ["practice:notes/Book.md"]);
  assert.equal(x.probes, 1);
  assert.equal(x.reads, 2, "path metadata only: selection then dispatch");
});

test("M2 changed note and unavailable provider fail without a first-value dispatch", async () => {
  const x = setup();
  x.root.buttons("Learn from a note")[0].click();
  await flush();
  x.setNote("notes/Another.md");
  x.root.buttons("Explain this note")[0].click();
  await flush();
  assert.equal(x.sent.length, 0);
  assert.equal(x.probes, 0, "note mismatch rejects before provider check");
  assert.ok(x.root.findAll().some(el => el.cls === "nox-onboarding-error" &&
    el.text.includes("changed")));

  x.root.buttons("Use current note")[0].click();
  await flush();
  x.setHealth("offline");
  x.root.buttons("Explain this note")[0].click();
  await flush();
  assert.equal(x.sent.length, 0);
  assert.equal(x.probes, 1);
  assert.ok(x.root.findAll().some(el => el.cls === "nox-onboarding-error" &&
    el.text.includes("provider")));
});
