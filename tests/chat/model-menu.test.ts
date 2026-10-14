import assert from "node:assert/strict";
import test from "node:test";
import { modelMenuItems } from "../../src/chat/model-menu";

test("empty provider catalog offers only runtime default unless a manual model is selected", () => {
  assert.deepEqual(modelMenuItems([]), [{ id: "", name: "Runtime default" }]);
  assert.deepEqual(modelMenuItems([], "custom-codex-model"), [
    { id: "", name: "Runtime default" }, { id: "custom-codex-model", name: "custom-codex-model" },
  ]);
});

test("discovered model retains its display name without a duplicate manual option", () => {
  assert.deepEqual(modelMenuItems([{ id: "model-a", name: "Model A" }], "model-a"), [
    { id: "", name: "Runtime default" }, { id: "model-a", name: "Model A" },
  ]);
});
