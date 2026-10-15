import assert from "node:assert/strict";
import test from "node:test";
import { NoxMenuState } from "../../src/chat/menu";

function createRow(id: string) {
  const classes = new Set<string>();
  return {
    id,
    classes,
    toggleClass(className: string, enabled: boolean) {
      if (enabled) classes.add(className);
      else classes.delete(className);
    },
  } as unknown as HTMLElement & { classes: Set<string> };
}

function createTrigger() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
  } as unknown as HTMLElement & { attributes: Map<string, string> };
}

test("menu state wraps active rows and exposes the active descendant", () => {
  const state = new NoxMenuState();
  const rows = [createRow("first"), createRow("second")];
  const trigger = createTrigger();

  state.setRows(rows);
  state.openAt(1);

  assert.equal(state.isOpen, true);
  assert.equal(state.activeIndex, 1);
  assert.equal(rows[1].classes.has("is-active"), true);

  state.move(1);
  assert.equal(state.activeIndex, 0);
  assert.equal(rows[0].classes.has("is-active"), true);
  assert.equal(rows[1].classes.has("is-active"), false);

  state.syncTrigger(trigger, "actions-menu");
  assert.equal(trigger.attributes.get("aria-controls"), "actions-menu");
  assert.equal(trigger.attributes.get("aria-expanded"), "true");
  assert.equal(trigger.attributes.get("aria-activedescendant"), "first");

  state.close();
  state.syncTrigger(trigger, "actions-menu");
  assert.equal(trigger.attributes.get("aria-expanded"), "false");
  assert.equal(trigger.attributes.has("aria-activedescendant"), false);
});

test("model picker opens on selected index before rows are rendered", () => {
  const state = new NoxMenuState();
  const trigger = createTrigger();
  state.openAt(2);
  state.setRows([createRow("model-a"), createRow("model-b"), createRow("model-c")]);

  assert.equal(state.activeIndex, 2);
  state.syncTrigger(trigger, "nox-model-menu");
  assert.equal(trigger.attributes.get("aria-activedescendant"), "model-c");

  // ArrowUp changes virtual focus only; choosing a model remains a separate action.
  state.move(-1);
  state.syncTrigger(trigger, "nox-model-menu");
  assert.equal(trigger.attributes.get("aria-activedescendant"), "model-b");

  state.close();
  state.syncTrigger(trigger, "nox-model-menu");
  assert.equal(trigger.attributes.has("aria-activedescendant"), false);
});
