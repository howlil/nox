import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActionInstruction,
  buildPracticeEvaluationInstruction,
  buildPracticeQuestionInstruction,
  buildProgramScopedPracticeInstruction,
} from "../../packages/core/src/application/action-builders";

test("action instructions preserve each learning contract", () => {
  assert.match(
    buildActionInstruction("ask"),
    /Learning mode: ask/,
  );
  assert.match(
    buildActionInstruction("explain"),
    /cause\/effect|dependency relationships/,
  );
  assert.match(
    buildActionInstruction("review"),
    /learning-review/,
  );
  assert.match(
    buildActionInstruction("review"),
    /missing-relation/,
  );
  assert.match(
    buildActionInstruction("edit"),
    /edit-proposal/,
  );
  assert.match(
    buildActionInstruction("edit"),
    /plugin applies proposals only after approval/,
  );
});

test("practice question keeps adversarial user content intact", () => {
  const request =
    '# markdown\n{"json":true}\n' +
    String.fromCharCode(96).repeat(3) +
    "\n日本語";

  const instruction =
    buildPracticeQuestionInstruction(request);

  assert.match(instruction, /Learning mode: practice/);
  assert.ok(instruction.includes(request));
  assert.match(instruction, /learning-practice/);
});

test("practice evaluation preserves the exact question and answer", () => {
  const instruction =
    buildPracticeEvaluationInstruction({
      question: "Why does order matter?",
      concept: "indexes",
      answer: 'A -> B\n{"reason":"ordering"}',
    });

  assert.ok(
    instruction.includes("Why does order matter?"),
  );
  assert.ok(
    instruction.includes(
      'A -> B\n{"reason":"ordering"}',
    ),
  );
  assert.match(instruction, /correct\|partial\|incorrect/);
});


test("visual affordances are restricted to ordinary narrative output", () => {
  assert.match(buildActionInstruction("ask"), /html-preview/);
  assert.match(buildActionInstruction("explain"), /nox-chart/);
  assert.doesNotMatch(buildActionInstruction("review"), /html-preview/);
  assert.doesNotMatch(buildActionInstruction("edit"), /nox-chart/);
});

test("program scope uses goal and objective without the backend-only legacy policy", () => {
  const result = buildProgramScopedPracticeInstruction({
    mode: "ASSESSMENT", goal: "Learn Japanese N5",
    objective: { outcome: "Recognize hiragana", rubric: ["Read common hiragana"] },
    hasQuestion: false,
  }, buildPracticeQuestionInstruction("Start"));
  assert.match(result, /Learn Japanese N5/);
  assert.match(result, /Recognize hiragana/);
  assert.match(result, /learning-scope/);
  assert.match(result, /learning-practice/);
  assert.doesNotMatch(result, /backend engineering only/);
});
