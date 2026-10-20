import assert from "node:assert/strict";
import test from "node:test";
import { StreamTextPresenter } from "../../src/features/conversation/view/stream-text-presenter";

function harness() {
  let next = 0;
  const scheduled = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  const nodes: Array<{ text: string; appendData(text: string): void }> = [];
  const container = {
    ownerDocument: {
      createTextNode: (text: string) => ({
        text, appendData(delta: string) { this.text += delta; },
      }),
    },
    appendChild(node: (typeof nodes)[number]) { nodes.push(node); },
  } as unknown as HTMLElement;
  const presenter = new StreamTextPresenter({
    request: callback => {
      const id = ++next;
      scheduled.set(id, callback);
      return id;
    },
    cancel: id => { cancelled.push(id); scheduled.delete(id); },
  });
  const fire = () => {
    const entries = [...scheduled.entries()];
    scheduled.clear();
    for (const [, callback] of entries) callback(16);
  };
  return { presenter, scheduled, cancelled, nodes, container, fire };
}

test("coalesces stream deltas into one node, one frame per batch", () => {
  const h = harness();
  h.presenter.append(h.container, "Hello");
  h.presenter.append(h.container, " world");
  assert.equal(h.scheduled.size, 1);
  assert.equal(h.nodes.length, 0);
  h.fire();
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].text, "Hello world");
  h.presenter.append(h.container, "!");
  h.fire();
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].text, "Hello world!");
  assert.equal(h.presenter.text, "Hello world!");
});

test("reset cancels pending UI work so stale frames cannot paint a new session", () => {
  const h = harness();
  h.presenter.append(h.container, "old stream");
  h.presenter.reset();
  assert.deepEqual(h.cancelled, [1]);
  assert.equal(h.scheduled.size, 0);
  assert.equal(h.presenter.text, "");
  h.fire();
  assert.equal(h.nodes.length, 0);
  h.presenter.append(h.container, "new turn");
  h.fire();
  assert.equal(h.nodes[0].text, "new turn");
});

test("detach drops stale DOM while preserving committed response text for actions", () => {
  const h = harness();
  h.presenter.append(h.container, "answer");
  h.presenter.flush();
  assert.equal(h.nodes[0].text, "answer");
  h.presenter.detach();
  assert.equal(h.presenter.text, "answer");
  h.presenter.dispose();
  assert.equal(h.presenter.text, "");
});

test("a canceled frame delivered late cannot consume the next turn's frame", () => {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const canceled: number[] = [];
  const textNodes: Array<{ value: string; appendData(value: string): void }> = [];
  const container = {
    ownerDocument: {
      createTextNode: (value: string) => ({
        value, appendData(delta: string) { this.value += delta; },
      }),
    },
    appendChild: (node: (typeof textNodes)[number]) => textNodes.push(node),
  } as unknown as HTMLElement;
  const presenter = new StreamTextPresenter({
    request: callback => {
      const id = ++next;
      callbacks.set(id, callback);
      return id;
    },
    cancel: id => { canceled.push(id); },
  });
  presenter.append(container, "stale turn");
  const stale = callbacks.get(1)!;
  presenter.reset();
  presenter.append(container, "current turn");
  assert.deepEqual(canceled, [1]);
  stale(0); // simulate a callback already queued when cancellation occurs
  assert.equal(textNodes.length, 0);
  assert.equal(presenter.text, "current turn");
  callbacks.get(2)!(16);
  assert.equal(textNodes.length, 1);
  assert.equal(textNodes[0].value, "current turn");
  presenter.dispose();
});

test("switching stream DOM container flushes the old text without duplicating next text", () => {
  const h = harness();
  const otherNodes: Array<{ text: string; appendData(text: string): void }> = [];
  const second = {
    ownerDocument: h.container.ownerDocument,
    appendChild: (node: (typeof otherNodes)[number]) => otherNodes.push(node),
  } as unknown as HTMLElement;
  h.presenter.append(h.container, "first");
  h.presenter.append(second, "second");
  assert.equal(h.nodes.length, 1);
  assert.equal(h.nodes[0].text, "first");
  assert.equal(otherNodes.length, 0);
  h.fire();
  assert.equal(otherNodes[0].text, "second");
  assert.equal(h.presenter.text, "firstsecond");
});
