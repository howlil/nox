import assert from "node:assert/strict";
import test from "node:test";
import { ProgramPlanGenerator } from "../../src/features/learning/program/ProgramPlanGenerator";
import type { ProgramConstraints } from "../../src/domain/learning-program/types";

const base: ProgramConstraints = {
  minutesPerSession: 45, sessionsPerWeek: 3,
  sourcePaths: [], sourceBound: false, excludedTopics: [],
};
const payload = (sources: string[] = []) => ({
  kind: "curriculum",
  objectives: [
    { id: "basics", title: "Basics", outcome: "Explain the main concepts",
      prerequisiteIds: [], estimatedMinutes: 45, rubric: ["Explain independently"],
      sourceRefs: sources, priority: "core" },
  ],
});
function harness(sourceRefs: string[] = []) {
  let resolved = 0;
  let prompt = "";
  let inference = 0;
  const contexts = {
    resolve: async () => {
      resolved++;
      return { activeNote: { path: "notes/selected.md",
        content: "PRIVATE_NOTE_CONTENT_DO_NOT_LEAK" }, explicit: [] };
    },
  };
  const runtime = {
    supportsSourceIsolation: () => true,
    send: async function* (input: { prompt: string }) {
      inference++;
      prompt = input.prompt;
      yield { type: "text", content: "```learning-program\n" +
        JSON.stringify(payload(sourceRefs)) + "\n```" };
      yield { type: "completed" };
    },
  };
  return {
    generator: new ProgramPlanGenerator(runtime as never, contexts as never,
      () => undefined, () => Date.now()),
    resolved: () => resolved, prompt: () => prompt, inference: () => inference,
  };
}

test("M1 general goal never reads open vault notes or sends them to provider", async () => {
  const h = harness();
  const program = await h.generator.generate("Understand databases", base, new AbortController().signal);
  assert.equal(program.goal, "Understand databases");
  assert.equal(h.resolved(), 0, "general curriculum must not resolve vault context");
  assert.equal(h.inference(), 1);
  assert.doesNotMatch(h.prompt(), /notes\/selected\.md|PRIVATE_NOTE_CONTENT_DO_NOT_LEAK/);
  assert.match(h.prompt(), /Understand databases/);
});
test("M1 only explicit source-bound generation includes the approved note text", async () => {
  const h = harness(["notes/selected.md"]);
  const result = await h.generator.generate("Study note", { ...base, sourceBound: true,
    sourcePaths: ["notes/selected.md"] }, new AbortController().signal);
  assert.deepEqual(result.constraints.sourcePaths, ["notes/selected.md"]);
  assert.equal(h.resolved(), 1);
  assert.match(h.prompt(), /PRIVATE_NOTE_CONTENT_DO_NOT_LEAK/);
});
test("M1 changed note rejects before provider inference without silent source substitution", async () => {
  const h = harness(["notes/selected.md"]);
  await assert.rejects(h.generator.generate("Study note", { ...base,
    sourceBound: true, sourcePaths: ["notes/previous.md"],
  }, new AbortController().signal), /Source note changed/);
  assert.equal(h.inference(), 0);
});
test("M1 provider source isolation is required before reading the vault or sending a request", async () => {
  let sent = 0;
  let reads = 0;
  const generator = new ProgramPlanGenerator({
    supportsSourceIsolation: () => false,
    send: async function* () { sent++; yield { type: "completed" }; },
  } as never, { resolve: async () => {
    reads++;
    return { activeNote: { path: "notes/selected.md", content: "secret" }, explicit: [] };
  } } as never, () => undefined, () => Date.now());
  await assert.rejects(generator.generate("Study note", {
    ...base, sourceBound: true, sourcePaths: ["notes/selected.md"],
  }, new AbortController().signal), /isolated provider/);
  assert.equal(sent, 0);
  assert.equal(reads, 0);
});
