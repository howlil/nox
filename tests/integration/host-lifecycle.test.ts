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
