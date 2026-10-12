import assert from "node:assert/strict";
import test from "node:test";
import { planReplacement } from "../../../src/domain/mutation/replacement";

test("plans one exact replacement", () => {
  const result = planReplacement(
    "before target after",
    "target",
    "replacement",
  );

  assert.deepEqual(result, {
    ok: true,
    index: 7,
    next: "before replacement after",
  });
});

test("rejects stale replacements", () => {
  assert.deepEqual(
    planReplacement("current", "missing", "next"),
    { ok: false, reason: "stale" },
  );
});

test("rejects ambiguous replacements", () => {
  assert.deepEqual(
    planReplacement("x target y target", "target", "next"),
    { ok: false, reason: "ambiguous" },
  );
});

test("supports replacements at boundaries and deletion", () => {
  assert.deepEqual(
    planReplacement("target rest", "target", "new"),
    {
      ok: true,
      index: 0,
      next: "new rest",
    },
  );

  assert.deepEqual(
    planReplacement("rest target", "target", ""),
    {
      ok: true,
      index: 5,
      next: "rest ",
    },
  );
});

test("supports multiline, CRLF, and unicode content", () => {
  assert.equal(
    planReplacement(
      "a\r\n日本語\r\nb",
      "日本語",
      "data",
    ).ok,
    true,
  );

  assert.deepEqual(
    planReplacement(
      "line one\nline two",
      "line one\nline two",
      "merged",
    ),
    {
      ok: true,
      index: 0,
      next: "merged",
    },
  );
});

test("empty originals are stale and non-overlapping duplicates are ambiguous", () => {
  assert.deepEqual(
    planReplacement("content", "", "x"),
    { ok: false, reason: "stale" },
  );

  assert.deepEqual(
    planReplacement("aaaa", "aa", "x"),
    { ok: false, reason: "ambiguous" },
  );
});
