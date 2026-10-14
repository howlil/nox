import assert from "node:assert/strict";
import test from "node:test";
import {
  HISTORY_SWIPE_LEADING,
  HISTORY_SWIPE_TRAILING,
  swipeAxis,
  swipeOffset,
  swipeRelease,
} from "../../src/chat/history-swipe";

test("gesture axis lock preserves vertical scroll and waits through diagonal noise", () => {
  assert.equal(swipeAxis(2, 3), "undecided");
  assert.equal(swipeAxis(15, 2), "horizontal");
  assert.equal(swipeAxis(-24, 7), "horizontal");
  assert.equal(swipeAxis(5, 24), "vertical");
  assert.equal(swipeAxis(-10, -25), "vertical");
  assert.equal(swipeAxis(12, 11), "undecided");
});

test("swipe resistance caps exposed drawers without blocking both directions", () => {
  assert.equal(swipeOffset(-60), -60);
  assert.equal(swipeOffset(40), 40);
  assert.equal(swipeOffset(0, -HISTORY_SWIPE_TRAILING), -HISTORY_SWIPE_TRAILING);
  assert.ok(swipeOffset(-400) < -HISTORY_SWIPE_TRAILING);
  assert.ok(swipeOffset(-400) > -200);
  assert.ok(swipeOffset(200) > HISTORY_SWIPE_LEADING);
  assert.ok(swipeOffset(200) < 100);
});

test("horizontal swipe release opens respective actions or snaps closed", () => {
  assert.deepEqual(swipeRelease(0, 0, 300), { side: null, full: false, offset: 0 });
  assert.deepEqual(swipeRelease(-80, 0, 300), { side: "trailing", full: false, offset: -144 });
  assert.deepEqual(swipeRelease(50, 0, 300), { side: "leading", full: false, offset: 72 });
  assert.equal(swipeRelease(-220, 0, 300).full, true);
  assert.equal(swipeRelease(170, 0, 300).full, true);
  assert.equal(swipeRelease(-40, -350, 300).side, "trailing");
  assert.equal(swipeRelease(15, 0, 300).side, null);
});
