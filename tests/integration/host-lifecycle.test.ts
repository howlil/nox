import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { bindObsidianLearningLifecycle } from "../../src/host/obsidian/lifecycle";

test("M3 Obsidian host owns the same DOM, workspace, vault and idle subscriptions", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentMock = { hidden: false };
  const dom = new Map<string, (...args: unknown[]) => void>();
  const workspace = new Map<string, (...args: unknown[]) => void>();
  const vault = new Map<string, (...args: unknown[]) => void>();
  const intervals: Array<{ ms: number; callback: () => void }> = [];
  const registeredEvents: unknown[] = [];
  const idle: boolean[] = [];
  const active: boolean[] = [];
  const focused: string[] = [];
  const renamed: string[] = [];

  Object.defineProperty(globalThis, "document", { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setInterval: (callback: () => void, ms: number) => {
      intervals.push({ callback, ms });
      return 77;
    } },
  });
  try {
    const plugin = {
      app: {
        workspace: { on: (event: string, callback: (...args: unknown[]) => void) => {
          workspace.set(event, callback); return { event };
        } },
        vault: { on: (event: string, callback: (...args: unknown[]) => void) => {
          vault.set(event, callback); return { event };
        } },
      },
      registerEvent: (event: unknown) => { registeredEvents.push(event); },
      registerDomEvent: (_target: unknown, event: string,
        callback: (...args: unknown[]) => void) => { dom.set(event, callback); },
      registerInterval: (interval: number) => { assert.equal(interval, 77); },
    };
    const programs = {
      setIdle: async (value: boolean) => { idle.push(value); },
      setAppInactive: async (value: boolean) => { active.push(value); },
      focusMaterial: async (path: string) => { focused.push(path); },
      renameMaterial: async (from: string, to: string) => { renamed.push(from + " -> " + to); },
    };
    bindObsidianLearningLifecycle(plugin as never, programs as never);

    assert.deepEqual([...dom.keys()].sort(), ["keydown", "pointerdown", "scroll", "visibilitychange"]);
    assert.deepEqual([...workspace.keys()], ["file-open"]);
    assert.deepEqual([...vault.keys()], ["rename"]);
    assert.equal(registeredEvents.length, 2);
    assert.equal(intervals[0]?.ms, 30_000);
    assert.deepEqual(idle, [], "registering the observer must never write idle state");

    workspace.get("file-open")?.({ extension: "txt", path: "ignore.txt" });
    workspace.get("file-open")?.({ extension: "md", path: "topic.md" });
    vault.get("rename")?.(Object.assign(new TFile("moved.md"), { extension: "md" }), "old.md");
    documentMock.hidden = true;
    dom.get("visibilitychange")?.();
    dom.get("pointerdown")?.();
    await new Promise<void>(resolve => setImmediate(resolve));

    assert.deepEqual(focused, ["topic.md"]);
    assert.deepEqual(renamed, ["old.md -> moved.md"]);
    assert.deepEqual(active, [true]);
    assert.deepEqual(idle, [], "mere interaction cannot fabricate a persisted idle transition");
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("M2 failed rename attribution is reported once and retried in original order on existing tick", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const { BackgroundWriteFeedback } = await import("../../src/host/obsidian/background-write-feedback");
  const notifications: string[] = [];
  const feedback = new BackgroundWriteFeedback(message => notifications.push(message));
  const vaultEvents = new Map<string, (...args: unknown[]) => void>();
  let tick: (() => void) | undefined;
  let failures = 2;
  const committed: string[] = [];
  const attempted: string[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setInterval: (callback: () => void) => { tick = callback; return 77; },
  } });
  const plugin = { app: {
    workspace: { on: () => ({}) },
    vault: { on: (event: string, cb: (...args: unknown[]) => void) => {
      vaultEvents.set(event, cb); return {};
    } },
  }, registerDomEvent: () => {}, registerInterval: () => {}, registerEvent: () => {} };
  const programs = {
    setIdle: async () => {}, setAppInactive: async () => {},
    focusMaterial: async () => {},
    renameMaterial: async (from: string, to: string) => {
      attempted.push(from + " -> " + to);
      if (failures > 0) { failures--; throw new Error("temporary vault error"); }
      committed.push(from + " -> " + to);
    },
  };
  try {
    bindObsidianLearningLifecycle(plugin as never, programs as never, feedback);
    const rename = vaultEvents.get("rename")!;
    rename(Object.assign(new TFile("b.md"), { extension: "md" }), "a.md");
    rename(Object.assign(new TFile("c.md"), { extension: "md" }), "b.md");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(committed, []);
    assert.equal(notifications.length, 1, "failure is visible once, not once per event");
    tick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(committed, []);
    assert.equal(notifications.length, 1, "transient failure does not spam notices");
    tick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(committed, ["a.md -> b.md", "b.md -> c.md"]);
    assert.deepEqual(attempted, [
      "a.md -> b.md", "a.md -> b.md", "a.md -> b.md", "b.md -> c.md",
    ]);
    tick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(committed.length, 2, "subsequent ticks never duplicate a completed rename");
    failures = 1;
    rename(Object.assign(new TFile("d.md"), { extension: "md" }), "c.md");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(notifications.length, 2, "successful recovery clears the failure notice latch");
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("M2 idle and focus background write failures are visible without blocking callbacks", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const { BackgroundWriteFeedback } = await import("../../src/host/obsidian/background-write-feedback");
  const notices: string[] = [];
  const feedback = new BackgroundWriteFeedback(message => notices.push(message));
  const dom = new Map<string, (...args: unknown[]) => void>();
  const workspace = new Map<string, (...args: unknown[]) => void>();
  let tick: (() => void) | undefined;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setInterval: (callback: () => void) => { tick = callback; return 77; },
  } });
  let focusFails = true;
  const plugin = { app: {
    workspace: { on: (event: string, cb: (...args: unknown[]) => void) => {
      workspace.set(event, cb); return {};
    } },
    vault: { on: () => ({}) },
  }, registerDomEvent: (_target: unknown, event: string, cb: (...args: unknown[]) => void) => {
    dom.set(event, cb);
  }, registerInterval: () => {}, registerEvent: () => {} };
  const programs = {
    setIdle: async () => { throw new Error("idle CAS failed"); },
    setAppInactive: async () => { throw new Error("visibility CAS failed"); },
    focusMaterial: async () => {
      if (focusFails) throw new Error("focus CAS failed");
    },
    renameMaterial: async () => {},
  };
  try {
    bindObsidianLearningLifecycle(plugin as never, programs as never, feedback);
    workspace.get("file-open")?.({ extension: "md", path: "note.md" });
    await new Promise<void>(resolve => setImmediate(resolve));
    workspace.get("file-open")?.({ extension: "md", path: "note.md" });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(notices.length, 1);
    focusFails = false;
    workspace.get("file-open")?.({ extension: "md", path: "note.md" });
    await new Promise<void>(resolve => setImmediate(resolve));
    focusFails = true;
    workspace.get("file-open")?.({ extension: "md", path: "note.md" });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(notices.length, 2, "recovery allows new failures to be reported");
    dom.get("visibilitychange")?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(notices.length, 3);
    // No idle state mutation until the threshold; the existing timer remains wired.
    tick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(notices.length, 3);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("M2 failure notice errors never escape the observed background operation", async () => {
  const { BackgroundWriteFeedback } = await import("../../src/host/obsidian/background-write-feedback");
  const feedback = new BackgroundWriteFeedback(() => { throw new Error("notice host unavailable"); });
  await assert.doesNotReject(feedback.observe("focus", async () => {
    throw new Error("vault write failed");
  }));
  await assert.doesNotReject(feedback.observe("focus", async () => {}));
});
