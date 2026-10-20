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
    onCreated: async () => { sent.push("created"); },
    onStart: async () => { sent.push("start"); },
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

const programId = "00000000-0000-4000-8000-000000000001";
const firstObjective = {
  id: "intro", title: "First working system", outcome: "Explain the interface contract",
  prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Can describe inputs and outputs"],
  sourceRefs: [], priority: "core" as const,
};
const laterObjective = {
  ...firstObjective, id: "advanced", title: "Advanced", prerequisiteIds: ["intro"],
};
const m3Program = {
  version: 1 as const, id: programId, goal: "Build a reliable service",
  createdAt: Date.now(), planVersion: 1,
  objectives: [laterObjective, firstObjective],
  constraints: { sourceBound: false, sourcePaths: [], excludedTopics: [],
    minutesPerSession: 45, sessionsPerWeek: 3 },
};
function setupM3(overrides: {
  failWorkspace?: boolean; failDismiss?: boolean; failReadModel?: boolean;
  failReceipt?: boolean; expiredPreview?: boolean;
} = {}) {
  const root = new FakeElement();
  const calls: string[] = [];
  const operations: string[] = [];
  const learning = {
    saveOnboardingDraft: async (draft: { approval?: unknown }) => {
      if (overrides.failReceipt && draft.approval) throw Error("Cannot save onboarding receipt");
    },
    checkRuntime: async () => ({ status: "ready" }),
    previewLearningProgram: async () => { calls.push("preview"); return m3Program; },
    approveLearningProgram: async (_id: string, op: string) => {
      calls.push("approve-only"); operations.push(op);
      if (overrides.expiredPreview) throw Error("The preview expired. Generate a fresh learning blueprint.");
      return m3Program;
    },
    approveLearningWorkspace: async (_id: string, op: string) => {
      calls.push("approve-workspace"); operations.push(op);
      if (overrides.failWorkspace && operations.length === 1) throw Error("Workspace write failed");
      return { ...m3Program, workspaceApproved: true };
    },
    dismissOnboarding: async () => {
      calls.push("dismiss");
      if (overrides.failDismiss) throw Error("Cannot save dismissal");
    },
    getProgramOverview: async () => {
      calls.push("overview");
      if (overrides.failReadModel) throw Error("Overview unavailable");
      return {
        active: false,
        next: { kind: "diagnostic", objectiveId: "intro" },
        objectives: [],
      };
    },
    getProgramMenuState: async () => ({ activeProgramId: programId }),
  } as unknown as LearningController;
  const callbacks = {
    onSkip: () => {},
    onCreated: async () => { calls.push("later"); },
    onStart: async (id: string, objective: string) => { calls.push("start:" + id + ":" + objective); },
    onQuickPlan: async () => {},
    onNoteAction: async () => {},
  };
  new OnboardingFlow(dom(root), learning, callbacks);
  const toPreview = async () => {
    root.buttons("Start with a goal")[0].click();
    root.buttons("Prefer guided setup?")[0].click();
    root.querySelector<FakeElement>(".nox-onboarding-field")!.input(m3Program.goal);
    root.buttons("Generate blueprint")[0].click();
    await flush();
    assert.equal(root.buttons("Use plan only").length, 1);
  };
  return { root, calls, operations, toPreview };
}

test("M3 guided setup can approve a plan without workspace and offers first adaptive objective", async () => {
  const x = setupM3();
  await x.toPreview();
  assert.equal(x.calls.filter(value => value === "preview").length, 1);
  x.root.buttons("Use plan only")[0].click();
  await flush();
  assert.equal(x.root.buttons("Start first objective").length, 1);
  assert.equal(x.root.buttons("Maybe later").length, 1);
  assert.equal(x.root.findAll().find(el => el.cls === "nox-onboarding-name" &&
    el.text === firstObjective.title)?.text, firstObjective.title);
  assert.deepEqual(x.calls.slice(1), ["approve-only", "overview"]);
  x.root.buttons("Start first objective")[0].click();
  await flush();
  assert.equal(x.calls.at(-1), "start:" + programId + ":intro");
  assert.equal(x.calls.includes("later"), false);
});

test("M3 workspace choice uses the original writer only and allows a later exit", async () => {
  const x = setupM3();
  await x.toPreview();
  x.root.buttons("Create workspace")[0].click();
  await flush();
  assert.equal(x.calls.includes("approve-workspace"), true);
  assert.equal(x.calls.includes("approve-only"), false);
  x.root.buttons("Maybe later")[0].click();
  assert.equal(x.calls.at(-1), "later");
});

test("M3 workspace failure retries same operation and cannot switch to plan-only", async () => {
  const x = setupM3({ failWorkspace: true });
  await x.toPreview();
  x.root.buttons("Create workspace")[0].click();
  await flush();
  assert.equal(x.root.buttons("Use plan only").length, 0);
  assert.equal(x.root.buttons("Retry creating workspace").length, 1);
  x.root.buttons("Retry creating workspace")[0].click();
  await flush();
  assert.equal(x.root.buttons("Start first objective").length, 1);
  assert.equal(x.operations.length, 2);
  assert.equal(x.operations[0], x.operations[1], "retry must reuse operation identity");
});

test("M3 post-commit storage/read model failure never returns to approval and never repeats commit", async () => {
  const x = setupM3({ failDismiss: true, failReadModel: true });
  await x.toPreview();
  x.root.buttons("Use plan only")[0].click();
  await flush();
  assert.equal(x.root.buttons("Use plan only").length, 0);
  assert.equal(x.root.buttons("Maybe later").length, 1);
  assert.equal(x.root.buttons("Start first objective").length, 0);
  assert.equal(x.calls.filter(item => item === "approve-only").length, 1);
  assert.equal(x.root.findAll().some(el => el.cls === "nox-onboarding-error"), true);
});

test("M4 restart after committed plan recovers ready state without reapproval", async () => {
  const root = new FakeElement();
  const receipt = { programId, operationId: "11111111-1111-4111-8111-111111111111",
    withWorkspace: false };
  const calls: string[] = [];
  const drafts: Array<{ stage: string }> = [];
  const learning = {
    recoverOnboardingApproval: async () => {
      calls.push("reconcile"); return { ...m3Program, creationOperationId: receipt.operationId };
    },
    saveOnboardingDraft: async (draft: { stage: string }) => { drafts.push(draft); },
    getProgramOverview: async () => ({ active: false,
      next: { kind: "diagnostic", objectiveId: "intro" } }),
    getProgramMenuState: async () => ({ activeProgramId: programId }),
  } as unknown as LearningController;
  new OnboardingFlow(dom(root), learning, {
    onSkip: () => {},
    onCreated: async () => {},
    onStart: async () => { calls.push("start"); },
    onQuickPlan: async () => {},
    onNoteAction: async () => {},
  }, { version: 1, stage: "applying", goal: m3Program.goal, interests: [],
    purpose: "career", level: "beginner", minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false, approval: receipt });
  await flush();
  assert.deepEqual(calls, ["reconcile"]);
  assert.equal(drafts.at(-1)?.stage, "ready");
  assert.equal(root.buttons("Start first objective").length, 1);
  root.buttons("Start first objective")[0].click();
  await flush();
  assert.deepEqual(calls, ["reconcile", "start"]);
});

test("M4 partial workspace restore retries materialization without issuing another approval", async () => {
  const root = new FakeElement();
  const receipt = { programId, operationId: "11111111-1111-4111-8111-111111111111",
    withWorkspace: true };
  let attempts = 0;
  let approvals = 0;
  const learning = {
    recoverOnboardingApproval: async () => {
      attempts++;
      if (attempts === 1) throw Error("Workspace path is occupied by an unowned note");
      return { ...m3Program, workspaceApproved: true, creationOperationId: receipt.operationId };
    },
    approveLearningWorkspace: async () => { approvals++; throw Error("Never replay approval"); },
    saveOnboardingDraft: async () => {},
    getProgramOverview: async () => ({ active: false,
      next: { kind: "diagnostic", objectiveId: "intro" } }),
    getProgramMenuState: async () => ({ activeProgramId: programId }),
  } as unknown as LearningController;
  new OnboardingFlow(dom(root), learning, {
    onSkip: () => {},
    onCreated: async () => {},
    onStart: async () => {},
    onQuickPlan: async () => {},
    onNoteAction: async () => {},
  }, { version: 1, stage: "ready", goal: m3Program.goal, interests: [],
    purpose: "career", level: "beginner", minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false, approval: receipt });
  await flush();
  assert.equal(root.buttons("Retry recovery").length, 1);
  assert.equal(root.buttons("Start first objective").length, 0);
  root.buttons("Retry recovery")[0].click();
  await flush();
  assert.equal(attempts, 2);
  assert.equal(approvals, 0);
  assert.equal(root.buttons("Start first objective").length, 1);
});

test("M4 interrupted approval before CAS commit never silently recreates a program", async () => {
  const root = new FakeElement();
  const receipt = { programId, operationId: "11111111-1111-4111-8111-111111111111",
    withWorkspace: true };
  const calls: string[] = [];
  const learning = {
    recoverOnboardingApproval: async () => { calls.push("read-only reconciliation"); return null; },
    saveOnboardingDraft: async () => { calls.push("clear stale receipt"); },
  } as unknown as LearningController;
  new OnboardingFlow(dom(root), learning, {
    onSkip: () => {},
    onCreated: async () => {},
    onStart: async () => {},
    onQuickPlan: async () => {},
    onNoteAction: async () => {},
  }, { version: 1, stage: "applying", goal: m3Program.goal, interests: [],
    purpose: "career", level: "beginner", minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false, approval: receipt });
  await flush();
  assert.deepEqual(calls, ["read-only reconciliation", "clear stale receipt"]);
  assert.ok(root.findAll().some(el => el.cls === "nox-onboarding-error" &&
    el.text.includes("interrupted before commit")));
  assert.equal(root.buttons("Generate blueprint").length, 1);
});

test("M4 failed approval receipt write never reaches program CAS mutation", async () => {
  const x = setupM3({ failReceipt: true });
  await x.toPreview();
  x.root.buttons("Use plan only")[0].click();
  await flush();
  assert.equal(x.calls.includes("approve-only"), false);
  assert.equal(x.operations.length, 0);
  assert.equal(x.root.buttons("Retry saving plan").length, 1);
  assert.ok(x.root.findAll().some(el => el.cls === "nox-onboarding-error" &&
    el.text.includes("approval receipt")));
});

test("M4 expired preview resets approval intent and requires explicit re-generation", async () => {
  const x = setupM3({ expiredPreview: true });
  await x.toPreview();
  x.root.buttons("Use plan only")[0].click();
  await flush();
  assert.equal(x.root.buttons("Retry saving plan").length, 0);
  assert.equal(x.root.buttons("Generate blueprint").length, 1);
  assert.equal(x.operations.length, 1);
  assert.ok(x.root.findAll().some(el => el.cls === "nox-onboarding-error" &&
    el.text.includes("preview expired")));
});
