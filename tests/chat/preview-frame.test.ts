import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PREVIEW_HEIGHT, bindResponsivePreview, normalizePreviewHeight } from "../../src/chat/preview-frame";

test("preview auto height rejects malformed and adversarial dimensions", () => {
  for (const value of [null, undefined, "100", -2, NaN, Infinity, -Infinity, {}, 1_000_001]) {
    assert.equal(normalizePreviewHeight(value), null);
  }
  assert.equal(normalizePreviewHeight(0), 120);
  assert.equal(normalizePreviewHeight(320.2), 321);
  assert.equal(normalizePreviewHeight(50000), MAX_PREVIEW_HEIGHT);
});

function fakeWindow() {
  const handlers = new Set<(event: MessageEvent) => void>();
  const view = {
    addEventListener: (_type: string, callback: (event: MessageEvent) => void) => { handlers.add(callback); },
    removeEventListener: (_type: string, callback: (event: MessageEvent) => void) => { handlers.delete(callback); },
  } as unknown as Window;
  return {
    view, handlers,
    dispatch(event: unknown) {
      for (const handler of handlers) handler(event as MessageEvent);
    },
  };
}

function fakeFrame(view: Window) {
  const source = {} as Window;
  const style = { height: "" };
  const frame = {
    ownerDocument: { defaultView: view },
    contentWindow: source,
    isConnected: true,
    style,
    setCssStyles(styles: { height?: string }) { Object.assign(style, styles); },
  } as unknown as HTMLIFrameElement;
  return { frame, source, style };
}

test("preview resize messages bind to the iframe popout window and clean up", () => {
  const main = fakeWindow(), popout = fakeWindow();
  const { frame, source, style } = fakeFrame(popout.view);
  const release = bindResponsivePreview(frame, "instance");
  assert.equal(main.handlers.size, 0);
  assert.equal(popout.handlers.size, 1);
  popout.dispatch({ origin: "null", source,
    data: { kind: "nox-preview-resize", id: "wrong", height: 400 } });
  assert.equal(style.height, "");
  popout.dispatch({ origin: "https://example.invalid", source,
    data: { kind: "nox-preview-resize", id: "instance", height: 400 } });
  assert.equal(style.height, "");
  popout.dispatch({ origin: "null", source,
    data: { kind: "nox-preview-resize", id: "instance", height: 400 } });
  assert.equal(style.height, "400px");
  release();
  release();
  assert.equal(popout.handlers.size, 0);
});

test("two previews share one message listener per owning window", () => {
  const owner = fakeWindow();
  const a = fakeFrame(owner.view), b = fakeFrame(owner.view);
  const stopA = bindResponsivePreview(a.frame, "a");
  const stopB = bindResponsivePreview(b.frame, "b");
  assert.equal(owner.handlers.size, 1);
  stopA();
  assert.equal(owner.handlers.size, 1);
  stopB();
  assert.equal(owner.handlers.size, 0);
});


test("rapid content changes retain the final measured height and release cancels pending updates", () => {
  const callbacks = new Map<number, () => void>();
  let seq = 0;
  const owner = fakeWindow();
  (owner.view as Window & { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }).setTimeout =
    ((cb: () => void) => { const id = ++seq; callbacks.set(id, cb); return id; }) as typeof setTimeout;
  (owner.view as Window & { clearTimeout: typeof clearTimeout }).clearTimeout =
    ((id: number) => { callbacks.delete(id); }) as typeof clearTimeout;
  const { frame, source, style } = fakeFrame(owner.view);
  const stop = bindResponsivePreview(frame, "rapid");
  const send = (height: number): void => owner.dispatch({
    origin: "null", source, data: { kind: "nox-preview-resize", id: "rapid", height },
  });
  send(560);
  send(420);
  send(320);
  for (const [id, callback] of [...callbacks.entries()]) {
    callbacks.delete(id);
    callback();
  }
  assert.equal(style.height, "320px");
  send(440);
  stop();
  stop();
  assert.equal(callbacks.size, 0);
  assert.equal(owner.handlers.size, 0);
});
