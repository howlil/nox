import assert from "node:assert/strict";
import test from "node:test";
import { NoxPopoverState } from "../../src/chat/popover";

function createElement() {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  return {
    classes,
    attributes,
    toggleClass(className: string, enabled: boolean) {
      if (enabled) classes.add(className);
      else classes.delete(className);
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
  } as unknown as HTMLElement & {
    classes: Set<string>;
    attributes: Map<string, string>;
  };
}

test("popover state keeps visibility and aria state synchronized", () => {
  const element = createElement();
  const state = new NoxPopoverState(element);

  state.open();
  assert.equal(state.isOpen, true);
  assert.equal(element.classes.has("nox-hidden"), false);
  assert.equal(element.attributes.get("aria-hidden"), "false");

  state.close();
  assert.equal(state.isOpen, false);
  assert.equal(element.classes.has("nox-hidden"), true);
  assert.equal(element.attributes.get("aria-hidden"), "true");
});
