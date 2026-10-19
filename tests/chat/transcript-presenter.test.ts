import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "../../src/types";
import { TranscriptPresenter, type TranscriptRenderer } from "../../src/chat/transcript-presenter";

function renderer(events: string[]): TranscriptRenderer {
  return {
    clear: () => { events.push("clear"); },
    empty: () => { events.push("empty"); },
    user: msg => { events.push("user:" + msg.content); },
    thinking: msg => { events.push("thinking:" + msg.content); },
    assistant: async msg => { events.push("assistant:" + msg.content); },
    proposal: msg => { events.push("proposal:" + msg.content); },
    structured: msg => { events.push("structured:" + msg.content); },
    complete: () => { events.push("complete"); },
  };
}

test("restoration replays transcript in order without persisting session state", async () => {
  const events: string[] = [];
  const presenter = new TranscriptPresenter(async () => {});
  const messages: ChatMessage[] = [
    { role: "user", content: "Question" },
    { role: "assistant", content: "Answer", thought: "Reason" },
    { role: "assistant", content: "   " },
  ];
  assert.equal(await presenter.restore(messages, renderer(events)), true);
  assert.deepEqual(events, [
    "clear", "user:Question", "thinking:Answer", "assistant:Answer",
    "structured:Answer", "structured:   ", "complete",
  ]);
  assert.equal(presenter.isRestoring, false);
});

test("empty restore is delegated without displaying a stale answer", async () => {
  const events: string[] = [];
  const presenter = new TranscriptPresenter(async () => {});
  assert.equal(await presenter.restore([], renderer(events)), true);
  assert.deepEqual(events, ["empty"]);
});

test("navigation cancels old session at a cooperative render yield", async () => {
  let release!: () => void;
  let entered!: () => void;
  const atFrame = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const presenter = new TranscriptPresenter(async () => { entered(); await resume; });
  const oldEvents: string[] = [], newEvents: string[] = [];
  const oldMessages = Array.from({ length: 10 }, (_, index) =>
    ({ role: "user", content: "old" + index } as ChatMessage));
  const oldRestore = presenter.restore(oldMessages, renderer(oldEvents));
  await atFrame;
  presenter.cancel();
  const newRestore = presenter.restore([{ role: "user", content: "new" }], renderer(newEvents));
  release();
  assert.equal(await oldRestore, false);
  assert.equal(await newRestore, true);
  assert.equal(oldEvents.includes("complete"), false);
  assert.equal(oldEvents.some(event => event === "user:old9"), false);
  assert.deepEqual(newEvents, ["clear", "user:new", "complete"]);
});

test("assistant rendering errors clear restoration state for recovery", async () => {
  const presenter = new TranscriptPresenter(async () => {});
  const events: string[] = [];
  const callbacks = renderer(events);
  callbacks.assistant = async () => { throw new Error("render failed"); };
  await assert.rejects(
    presenter.restore([{ role: "assistant", content: "Answer" }], callbacks),
    /render failed/,
  );
  assert.equal(presenter.isRestoring, false);
});

test("late Markdown completion cannot append proposal controls into a switched session", async () => {
  let started!: () => void;
  let release!: () => void;
  const rendering = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const presenter = new TranscriptPresenter(async () => {});
  const oldEvents: string[] = [];
  const oldCallbacks = renderer(oldEvents);
  oldCallbacks.assistant = async () => { started(); await held; oldEvents.push("late-assistant"); };
  const restored = presenter.restore([{
    role: "assistant", content: "old answer",
    proposal: {} as NonNullable<ChatMessage["proposal"]>,
  }], oldCallbacks);
  await rendering;
  presenter.cancel();
  const nextEvents: string[] = [];
  const next = presenter.restore([{ role: "user", content: "new session" }], renderer(nextEvents));
  release();
  assert.equal(await restored, false);
  assert.equal(await next, true);
  assert.equal(oldEvents.some(event => event.startsWith("proposal:")), false);
  assert.equal(oldEvents.includes("structured:old answer"), false);
  assert.deepEqual(nextEvents, ["clear", "user:new session", "complete"]);
});
