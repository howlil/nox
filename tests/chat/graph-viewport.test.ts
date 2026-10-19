import assert from "node:assert/strict";
import test from "node:test";
import { graphDisplayWidth } from "../../src/chat/graph-viewport";

test("graph viewport preserves natural size for compact diagrams", () => {
  assert.equal(graphDisplayWidth(180, 768), 180);
  assert.equal(graphDisplayWidth(360, 768), 360);
});

test("graph viewport fits wide diagrams inside a narrow reading pane", () => {
  assert.equal(graphDisplayWidth(1600, 320), 304);
  assert.equal(graphDisplayWidth(1600, 390), 374);
  assert.equal(graphDisplayWidth(1600, 768), 752);
});

test("zoom is local, deterministic, and bounded to the supported range", () => {
  assert.equal(graphDisplayWidth(1600, 320, 0.75), 228);
  assert.equal(graphDisplayWidth(1600, 320, 3), 912);
  assert.equal(graphDisplayWidth(1600, 320, 100), 912);
  assert.equal(graphDisplayWidth(1600, 320, -5), 228);
});

test("untrusted measurements cannot create non-finite SVG widths", () => {
  assert.equal(graphDisplayWidth(Number.NaN, Number.NaN), 480);
  assert.equal(graphDisplayWidth(Number.POSITIVE_INFINITY, 320), 304);
  assert.ok(Number.isFinite(graphDisplayWidth(1e20, 320)));
});
