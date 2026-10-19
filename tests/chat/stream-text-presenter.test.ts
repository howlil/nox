import assert from "node:assert/strict";
import test from "node:test";
import { StreamTextPresenter } from "../../src/chat/stream-text-presenter";

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
