import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActionInstruction, buildPracticeQuestionInstruction,
} from "../../packages/core/src/application/action-builders";

test("default learning instructions are host-neutral", () => {
  const question = buildPracticeQuestionInstruction("Explain atomicity");
  const answer = buildActionInstruction("ask");
  for (const prompt of [question, answer]) {
    assert.doesNotMatch(prompt, /inside an Obsidian vault|AGENTS\.md|narrow Obsidian panes/);
    assert.match(prompt, /learning (assistant|mode)/i);
  }
});
