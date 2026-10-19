import assert from "node:assert/strict";
import test from "node:test";
import { mountCodeAnswerEditor } from "../../src/chat/code-answer-editor";
import { MAX_CODE_ANSWER_CHARS, tokenizeCode } from "../../src/chat/code-syntax";

type EventHandler = () => void;
class FakeInput {
  rows = 0;
  maxLength = 0;
  spellcheck = true;
  disabled = false;
  value = "";
  scrollHeight = 100;
  style: { height?: string } = {};
  removed = false;
  attrs = new Map<string, string>();
  events = new Map<string, EventHandler[]>();
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  addEventListener(name: string, cb: EventHandler) {
    this.events.set(name, [...(this.events.get(name) ?? []), cb]);
  }
  trigger(name: string) { for (const cb of this.events.get(name) ?? []) cb(); }
  remove() { this.removed = true; }
}
class FakeHost {
  // No owner document: exercises the safe fallback without a browser runtime.
  ownerDocument = undefined;
  inputs: FakeInput[] = [];
  notices: Array<{ textContent: string; remove(): void }> = [];
  createDiv() {
    const host = new FakeHost();
    // When using a root as parent, preserve references for assertions.
    this.child = host;
    return host;
  }
  child?: FakeHost;
  createEl(tag: string) {
    assert.equal(tag, "textarea");
    const node = new FakeInput();
    this.inputs.push(node);
    return node;
  }
  createNotice = () => ({ textContent: "", remove() {} });
}
class FakeEditableHost extends FakeHost {
  override createDiv(): any {
    if (!this.child) {
      const host = new FakeEditableHost();
      this.child = host;
      return host;
    }
    const notice = this.createNotice();
    this.notices.push(notice);
    return notice;
  }
}

test("M3 fallback grows/shrinks with content and preserves exact source", () => {
  const parent = new FakeEditableHost();
  const changes: string[] = [];
  const handle = mountCodeAnswerEditor(parent as unknown as HTMLElement, {
    language: "java", source: "class A {}", readOnly: false,
    onChange: source => changes.push(source),
  });
  const editor = (parent.child as FakeEditableHost).inputs[0];
  assert.equal(editor.value, "class A {}");
  assert.equal(editor.rows, 3);
  assert.equal(editor.maxLength, MAX_CODE_ANSWER_CHARS);
  editor.scrollHeight = 730;
  editor.value = "class A {\n" + "return 1;\n".repeat(90) + "}";
  editor.trigger("input");
  assert.equal(editor.style.height, "730px");
  editor.scrollHeight = 12;
  editor.value = "x";
  editor.trigger("input");
  assert.equal(editor.style.height, "92px", "shrinks after content deletion");
  assert.equal(changes.at(-1), "x");
  handle.setReadOnly(true);
  assert.equal(editor.disabled, true);
  handle.setReadOnly(false);
  assert.equal(editor.disabled, false);
  handle.destroy();
  handle.destroy();
  assert.equal(editor.removed, true);
});

test("M3 rejects over-limit pasted text without changing last valid draft", () => {
  const parent = new FakeEditableHost();
  const saved: string[] = [];
  const handle = mountCodeAnswerEditor(parent as unknown as HTMLElement, {
    language: "typescript", source: "const x = 1", readOnly: false,
    onChange: source => saved.push(source),
  });
  const host = parent.child as FakeEditableHost;
  const editor = host.inputs[0];
  editor.value = "const x = 42";
  editor.trigger("input");
  assert.deepEqual(saved, ["const x = 42"]);
  editor.value = "x".repeat(MAX_CODE_ANSWER_CHARS + 1);
  editor.trigger("input");
  assert.equal(editor.value, "const x = 42", "invalid input rolled back");
  assert.deepEqual(saved, ["const x = 42"], "controller never sees oversized code");
  assert.equal(host.notices[0].textContent, "Code answer limit: 40,000 characters.");
  editor.value = "y";
  editor.trigger("input");
  assert.deepEqual(saved, ["const x = 42", "y"]);
  assert.equal(host.notices[0].textContent, "");
  handle.destroy();
});

test("M3 syntax/highlighting source remains bounded at the same code answer limit", () => {
  const source = "const x = 1;\n".repeat(3_070);
  assert.ok(source.length <= MAX_CODE_ANSWER_CHARS);
  const tokens = tokenizeCode(source, "ts");
  assert.ok(tokens.length > 0);
  assert.equal(tokenizeCode("x".repeat(MAX_CODE_ANSWER_CHARS + 1), "ts").length, 0);
  assert.ok(tokens.every(token => token.from >= 0 && token.to <= source.length));
});
