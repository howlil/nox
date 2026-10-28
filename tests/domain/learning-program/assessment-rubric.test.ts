import assert from "node:assert/strict";
import test from "node:test";
import { coversCriteria } from "../../../packages/core/src/domain/learning-program/assessment-rubric";

test("assessment covers all expected criteria with matching outcome", () => {
  const criteria = ["Explain rollback", "Describe commit"];
  const results = [
    { criterion: "Explain rollback", met: true, evidence: "All-or-nothing" },
    { criterion: "Describe commit", met: true, evidence: "Persist changes" },
  ];
  assert.equal(coversCriteria(criteria, results, "correct"), true);
  assert.equal(coversCriteria(criteria, results.slice(0, 1), "correct"), false);
  assert.equal(coversCriteria(criteria, undefined, "correct"), false);
  assert.equal(coversCriteria(criteria, [results[0], results[0]], "correct"), false);
  assert.equal(coversCriteria(criteria, [{ ...results[0], criterion: "Unrelated" }, results[1]], "correct"), false);
  assert.equal(coversCriteria(criteria, [{ ...results[0], met: false }, results[1]], "correct"), false);
  assert.equal(coversCriteria(criteria, [{ ...results[0], met: false }, results[1]], "partial"), true);
  assert.equal(coversCriteria(criteria, results, "incorrect"), false);
});
