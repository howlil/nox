import { resolve } from "node:path";
import { openHeadlessNox, ScriptedProvider } from "./composition";
import type { LearningEvent, LearningRequest } from "@nox/core";

const codeFence = String.fromCharCode(96).repeat(3);
function practicePayload(value: unknown) {
  return codeFence + "learning-practice\n" + JSON.stringify(value) + "\n" + codeFence;
}

/**
 * Deliberately fixture-only CLI proof, not a production AI/provider CLI.
 * Usage: pnpm headless:demo --data-dir /path/to/exclusive-workspace
 */
async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] !== "--data-dir" || !argv[1] || argv.length !== 2) {
    throw new Error("Usage: pnpm headless:demo --data-dir /path/to/exclusive-workspace");
  }
  const root = resolve(argv[1]);
  const fixture = new ScriptedProvider([
    "Headless NOX Ask: this answer came through the actual RunLearningTurn orchestrator.",
    practicePayload({ kind: "question", concept: "transactions",
      question: "What does atomicity mean in a transaction?" }),
    practicePayload({ kind: "evaluation", concept: "transactions", outcome: "correct",
      feedback: "Atomicity is all-or-nothing.", misconceptions: [] }),
  ]);
  const host = await openHeadlessNox(root, fixture);
  try {
    const beforeEvidence = (await host.workspace.learningState.load()).evidence.length;
    const run = async (request: LearningRequest): Promise<LearningEvent[]> => {
      const events: LearningEvent[] = [];
      for await (const event of host.controller.run(request)) events.push(event);
      if (events.some(event => event.type === "failed" || event.type === "cancelled") ||
          !events.some(event => event.type === "completed")) {
        throw new Error("Headless turn failed: " + JSON.stringify(events.filter(
          event => event.type === "failed" || event.type === "cancelled")));
      }
      return events;
    };
    const ask = await run({ action: "ask", prompt: "Explain transaction atomicity", explicitContext: [] });
    const question = await run({ action: "practice", freePractice: true,
      prompt: "Ask me a practice question about atomicity", explicitContext: [] });
    const evaluation = await run({ action: "practice", freePractice: true,
      prompt: "All-or-nothing", explicitContext: [] });
    if (!question.some(e => e.type === "practice-question") ||
        !evaluation.some(e => e.type === "practice-evaluation")) {
      throw new Error("The real NOX Practice pipeline did not produce its required typed outcomes.");
    }
    const state = await host.workspace.learningState.load();
    if (state.evidence.length !== beforeEvidence + 1) throw new Error("Exactly one new durable learner evidence event was expected.");
    console.log(JSON.stringify({
      host: "node-headless-fixture",
      provider: "scripted, no external AI",
      ask: ask.filter(e => e.type === "response-delta").map(e => e.text).join(""),
      practiceQuestion: question.some(e => e.type === "practice-question"),
      practiceEvaluation: evaluation.some(e => e.type === "practice-evaluation"),
      transcriptMessages: host.controller.getSession().messages.length,
      durableEvidence: state.evidence.length,
      source: "NOX LearningController / RunLearningTurn",
    }, null, 2));
  } finally {
    await host.close();
  }
}
void main().catch(error => {
  console.error("M2 headless proof failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
