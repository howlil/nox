import assert from "node:assert/strict";
import test from "node:test";
import { watchCodeEditorRemoval } from "../../src/chat/code-editor-lifecycle";

class FakeObserver {
  static created: FakeObserver[] = [];
  connected = false;
  observations = 0;
  constructor(private callback: () => void) { FakeObserver.created.push(this); }
  observe() { this.connected = true; this.observations++; }
  disconnect() { this.connected = false; }
  flush() { if (this.connected) this.callback(); }
}
type Host = HTMLElement & { isConnected: boolean };
function testDocument() {
  FakeObserver.created = [];
  const doc = {
    documentElement: {},
    defaultView: { MutationObserver: FakeObserver },
  } as unknown as Document;
  const host = (connected = true) => ({
    ownerDocument: doc, isConnected: connected,
  } as Host);
  return { host };
}

test("M3 creates one observer per document and disconnects when last editor closes", () => {
  const { host } = testDocument();
  const first = host(), second = host();
  let cleaned = 0;
  const release1 = watchCodeEditorRemoval(first, () => { cleaned++; });
  const release2 = watchCodeEditorRemoval(second, () => { cleaned++; });
  assert.equal(FakeObserver.created.length, 1);
  assert.equal(FakeObserver.created[0].observations, 1);
  first.isConnected = false;
  FakeObserver.created[0].flush();
  assert.equal(cleaned, 1);
  assert.equal(FakeObserver.created[0].connected, true, "second editor still owns observer");
  release1(); // redundant after auto-detach
  second.isConnected = false;
  FakeObserver.created[0].flush();
  assert.equal(cleaned, 2);
  assert.equal(FakeObserver.created[0].connected, false);
  release2();
  const release3 = watchCodeEditorRemoval(host(), () => { cleaned++; });
  assert.equal(FakeObserver.created.length, 2, "new generation gets one new observer");
  release3();
  assert.equal(FakeObserver.created[1].connected, false);
});

test("M3 cleans editor created before its node is mounted, then detached", () => {
  const { host } = testDocument();
  const late = host(false);
  let cleaned = 0;
  const release = watchCodeEditorRemoval(late, () => { cleaned++; });
  FakeObserver.created[0].flush();
  assert.equal(cleaned, 0, "never-mounted editor must not be destroyed");
  late.isConnected = true;
  FakeObserver.created[0].flush();
  late.isConnected = false;
  FakeObserver.created[0].flush();
  assert.equal(cleaned, 1);
  assert.equal(FakeObserver.created[0].connected, false);
  release();
  assert.equal(cleaned, 1, "cleanup is called at most once");
});

test("M3 explicit dispose does not leak listeners or invoke stale cleanup", () => {
  const { host } = testDocument();
  const node = host();
  let cleaned = 0;
  const release = watchCodeEditorRemoval(node, () => { cleaned++; });
  release();
  release();
  node.isConnected = false;
  FakeObserver.created[0].flush();
  assert.equal(cleaned, 0, "explicit dispose owns teardown; callback does not run again");
  assert.equal(FakeObserver.created[0].connected, false);
});
