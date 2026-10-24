import { openBrowserNox, BrowserScriptedProvider } from "./composition";
import { BrowserWorkspace } from "./BrowserWorkspace";
import { DEFAULT_LEARNING_STATE, LearningStateWriteConflict,
  type LearningEvent, type LearningRequest } from "@nox/core";

const fence = String.fromCharCode(96).repeat(3);
const encoded = (value: unknown) => fence + "learning-practice\n" + JSON.stringify(value) + "\n" + fence;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function collect(stream: AsyncIterable<LearningEvent>): Promise<LearningEvent[]> {
  const events: LearningEvent[] = [];
  for await (const event of stream) events.push(event);
  check(events.at(-1)?.type === "completed", "NOX turn did not complete: " + JSON.stringify(events.at(-1)));
  check(!events.some(item => item.type === "failed" || item.type === "cancelled"),
    "NOX emitted failed/cancelled turn");
  return events;
}
const request = (action: "ask" | "practice", prompt: string): LearningRequest => ({
  action, prompt, freePractice: action === "practice", explicitContext: [],
});

async function run() {
  const stage = new URLSearchParams(location.search).get("stage");
  check(["one", "two", "three"].includes(stage ?? ""), "Unknown browser proof stage");
  const fixture = new BrowserScriptedProvider(
    stage === "one" ? [
      "Atomicity means all-or-nothing.",
      encoded({ kind: "question", concept: "transactions",
        question: "What does atomicity guarantee?" }),
    ] : stage === "two" ? [
      encoded({ kind: "evaluation", concept: "transactions", outcome: "correct",
        feedback: "All operations commit or none commit.", misconceptions: [] }),
    ] : [],
  );
  const host = await openBrowserNox("nox-browser-proof-m6", fixture);
  try {
    check(!host.capabilities.ambientNotes && !host.capabilities.editorMutation &&
      !host.capabilities.nativeUndo, "Browser must fail closed on note/editor capabilities");
    if (stage === "one") {
      const first = await collect(host.controller.run(request("ask", "Explain atomicity")));
      check(first.some(event => event.type === "response-delta"), "Missing real Ask response");
      const question = await collect(host.controller.run(request("practice", "Quiz me on atomicity")));
      check(question.some(event => event.type === "practice-question"), "Missing real practice question");
      check((await host.workspace.learningState.load()).evidence.length === 0,
        "A question without an answer must not grant evidence");
      // Context also legitimately includes the previous conversation. The
      // browser source adapter denies vault/note selection independently.
      check(fixture.contexts.length === 2, "Expected two provider invocations");
      const duplicate = await BrowserWorkspace.open("nox-browser-proof-m6");
      try {
        await Promise.all([
          host.workspace.sessionData.update(current => ({ ...current, "m6:first": "one" })),
          duplicate.sessionData.update(current => ({ ...current, "m6:second": "two" })),
        ]);
        const persisted = await duplicate.sessionData.read();
        check(persisted["m6:first"] === "one" && persisted["m6:second"] === "two",
          "Concurrent browser tabs lost a session transaction");
      } finally { duplicate.close(); }
    } else if (stage === "two") {
      check(host.controller.getSession().messages.some(message =>
        message.parts?.some(part => part.type === "practice-question")),
        "Fresh browser instance did not restore pending question");
      const result = await collect(host.controller.run(request("practice", "All-or-nothing")));
      check(result.some(event => event.type === "practice-evaluation"),
        "Actual NOX practice evaluation did not resume");
      const state = await host.workspace.learningState.load();
      check(state.evidence.length === 1 && state.evidence[0]?.scope === "learner",
        "Exactly one durable learner evidence item was required");
      check(host.controller.getSession().messages.some(message =>
        message.parts?.some(part => part.type === "practice-evaluation")),
        "Missing durable terminal transcript");
    } else {
      const before = await host.workspace.learningState.load();
      const stale = await host.workspace.learningState.load();
      check(before.evidence.length === 1, "Evidence was lost after browser reload");
      await host.workspace.learningState.save({ ...before, target: "retained" }, before);
      let conflict = false;
      try {
        await host.workspace.learningState.save({ ...stale, target: "stale" }, stale);
      } catch (error) { conflict = error instanceof LearningStateWriteConflict; }
      check(conflict, "Browser evidence CAS allowed stale state overwrite");
      const after = await host.workspace.learningState.load();
      check(after.target === "retained" && after.evidence.length === 1,
        "Rejected CAS corrupted browser evidence");
      const persisted = await host.workspace.sessionData.read();
      check(persisted["m6:first"] === "one" && persisted["m6:second"] === "two",
        "Concurrent session transaction lost data after reload");
      const beforeRollback = JSON.stringify(await host.workspace.sessionData.read());
      let abortCaught = false;
      try {
        await host.workspace.sessionData.update(() => {
          throw new Error("intentional transaction failure");
        });
      } catch (error) {
        abortCaught = error instanceof Error && error.message.includes("intentional");
      }
      check(abortCaught, "A failed browser session transaction was not rejected");
      check(JSON.stringify(await host.workspace.sessionData.read()) === beforeRollback,
        "Aborted browser transaction published unsaved session changes");

      // Fault injection uses another database so accepted learner progress
      // is not touched; malformed persisted state must never be rewritten.
      const corruptDatabase = "nox-browser-m6-corrupt";
      const initialized = await BrowserWorkspace.open(corruptDatabase);
      initialized.close();
      const raw = await new Promise<IDBDatabase>((resolve, reject) => {
        const opened = indexedDB.open(corruptDatabase, 1);
        opened.onsuccess = () => resolve(opened.result);
        opened.onerror = () => reject(opened.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = raw.transaction("records", "readwrite");
          tx.objectStore("records").put({ key: "progress", revision: 1,
            data: { version: 444, target: "corrupt", gaps: [], evidence: [] } });
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally { raw.close(); }
      const damaged = await BrowserWorkspace.open(corruptDatabase);
      try {
        let readDenied = false, writeDenied = false;
        try { await damaged.learningState.load(); } catch { readDenied = true; }
        try { await damaged.learningState.save(structuredClone(DEFAULT_LEARNING_STATE)); }
        catch { writeDenied = true; }
        check(readDenied && writeDenied,
          "Corrupt browser progress must fail closed on load and unguarded save");
        let stillDamaged = false;
        try { await damaged.learningState.load(); } catch { stillDamaged = true; }
        check(stillDamaged, "Failed progress repair overwrote a malformed record");
      } finally { damaged.close(); }
    }
    document.getElementById("result")!.textContent = "NOX_BROWSER_PROOF_PASS:" + stage;
    document.documentElement.dataset.proofStatus = "passed";
  } finally { host.close(); }
}

void run().catch(error => {
  document.getElementById("result")!.textContent =
    "NOX_BROWSER_PROOF_FAIL:" + (error instanceof Error ? error.message : String(error));
  document.documentElement.dataset.proofStatus = "failed";
});
