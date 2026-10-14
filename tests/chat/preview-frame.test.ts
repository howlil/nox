import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PREVIEW_HEIGHT, normalizePreviewHeight } from "../../src/chat/preview-frame";

test("preview auto height rejects malformed and adversarial dimensions", () => {
  for (const value of [null, undefined, "100", -2, NaN, Infinity, -Infinity, {}, 1_000_001]) {
    assert.equal(normalizePreviewHeight(value), null);
  }
  assert.equal(normalizePreviewHeight(0), 120);
  assert.equal(normalizePreviewHeight(320.2), 321);
  assert.equal(normalizePreviewHeight(50000), MAX_PREVIEW_HEIGHT);
});
