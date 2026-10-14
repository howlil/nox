import assert from "node:assert/strict";
import test from "node:test";
import {
  StructuredStreamEvent,
  StructuredStreamParser,
} from "../../src/agent/StructuredStreamParser";

const fence = String.fromCharCode(96).repeat(3);

test("scope decisions normalize at every streaming split", () => {
  for (const outcome of ["answer", "help", "out-of-scope"]) {
    const payload = `${fence}learning-scope\n${JSON.stringify({ outcome })}\n${fence}`;
    for (const events of parseAtEverySplit(payload)) {
      assert.deepEqual(events, [{ type: "scope-decision", outcome }]);
    }
  }
});

test("invalid and truncated scope decisions never become ordinary text", () => {
  for (const body of ['{"outcome":"free"}\n```', '{"outcome":true}\n```', '{broken}\n```', '{"outcome":"answer"}']) {
    const parser = new StructuredStreamParser();
    const events = [...parser.push(`${fence}learning-scope\n${body}`), ...parser.finish()];
    assert.ok(events.some((event) => event.type === "error"));
    assert.ok(!events.some((event) => event.type === "text" || event.type === "scope-decision"));
  }
});

function parseAtEverySplit(
  payload: string,
): StructuredStreamEvent[][] {
  const results: StructuredStreamEvent[][] = [];

  for (let split = 1; split < payload.length; split++) {
    const parser = new StructuredStreamParser();
    results.push([
      ...parser.push(payload.slice(0, split)),
      ...parser.push(payload.slice(split)),
      ...parser.finish(),
    ]);
  }

  return results;
}

function normalized(events: StructuredStreamEvent[]) {
  const text = events
    .filter(
      (event): event is { type: "text"; text: string } =>
        event.type === "text",
    )
    .map((event) => event.text)
    .join("");

  return [
    ...(text ? [{ type: "text", text }] : []),
    ...events.filter((event) => event.type !== "text"),
  ];
}

test("parses practice questions at every stream split boundary", () => {
  const payload =
    fence +
    "learning-practice\n" +
    JSON.stringify({
      kind: "question",
      concept: "indexes",
      question: "Why?",
    }) +
    "\n" +
    fence;

  for (const events of parseAtEverySplit(payload)) {
    assert.deepEqual(normalized(events), [
      {
        type: "practice-question",
        question: {
          kind: "question",
          concept: "indexes",
          question: "Why?",
        },
      },
    ]);
  }
});

test("parses practice evaluations, reviews, and edit proposals across split boundaries", () => {
  const cases: Array<{
    payload: string;
    expectedType:
      | "practice-evaluation"
      | "review-findings"
      | "proposal";
  }> = [
    {
      payload:
        fence +
        "learning-practice\n" +
        JSON.stringify({
          kind: "evaluation",
          concept: "indexes",
          outcome: "partial",
          feedback: "Missing one rule.",
          misconceptions: ["left-most prefix"],
        }) +
        "\n" +
        fence,
      expectedType: "practice-evaluation",
    },
    {
      payload:
        fence +
        "learning-review\n" +
        JSON.stringify({
          kind: "review",
          findings: [
            {
              kind: "missing-relation",
              concept: "MVCC",
              title: "Missing visibility rule",
              detail: "Snapshot visibility is not connected.",
            },
          ],
        }) +
        "\n" +
        fence,
      expectedType: "review-findings",
    },
    {
      payload:
        fence +
        "edit-proposal\n" +
        JSON.stringify({
          file: "note.md",
          original: "old",
          replacement: "new",
        }) +
        "\n" +
        fence,
      expectedType: "proposal",
    },
  ];

  for (const item of cases) {
    for (const events of parseAtEverySplit(item.payload)) {
      assert.equal(
        normalized(events)[0]?.type,
        item.expectedType,
      );
    }
  }
});

test("preserves visible text around structured blocks", () => {
  const parser = new StructuredStreamParser();
  const payload =
    "before\n" +
    fence +
    "learning-practice\n" +
    JSON.stringify({
      kind: "question",
      concept: "indexes",
      question: "Why?",
    }) +
    "\n" +
    fence +
    "\nafter";

  const events = [
    ...parser.push(payload),
    ...parser.finish(),
  ];

  assert.deepEqual(normalized(events), [
    { type: "text", text: "before\n\nafter" },
    {
      type: "practice-question",
      question: {
        kind: "question",
        concept: "indexes",
        question: "Why?",
      },
    },
  ]);
});

test("unknown fenced blocks remain visible text", () => {
  const parser = new StructuredStreamParser();
  const payload =
    fence + "unknown\nhello\n" + fence;

  const events = [
    ...parser.push(payload),
    ...parser.finish(),
  ];

  assert.equal(
    normalized(events)[0]?.type,
    "text",
  );
  if (normalized(events)[0]?.type === "text") {
    assert.equal(
      normalized(events)[0].text,
      payload,
    );
  }
});

test("reports malformed structured payloads and continues parsing later text", () => {
  const parser = new StructuredStreamParser();
  const events = [
    ...parser.push(
      fence +
        "learning-practice\n{bad json}\n" +
        fence +
        "\nvisible",
    ),
    ...parser.finish(),
  ];

  assert.equal(events[0]?.type, "error");
  assert.equal(
    normalized(events).some(
      (event) =>
        event.type === "text" &&
        event.text.includes("visible"),
    ),
    true,
  );
});

test("rejects invalid structured schemas", () => {
  const cases = [
    fence +
      "edit-proposal\n" +
      JSON.stringify({
        file: "note.md",
        original: "x",
        replacement: 42,
      }) +
      "\n" +
      fence,
    fence +
      "learning-practice\n" +
      JSON.stringify({
        kind: "evaluation",
        concept: "x",
        outcome: "maybe",
        feedback: "x",
        misconceptions: [],
      }) +
      "\n" +
      fence,
    fence +
      "learning-review\n" +
      JSON.stringify({
        kind: "review",
        findings: [
          {
            kind: "unknown",
            concept: "x",
            title: "x",
            detail: "x",
          },
        ],
      }) +
      "\n" +
      fence,
  ];

  for (const payload of cases) {
    const parser = new StructuredStreamParser();
    const events = parser.push(payload);
    assert.equal(events[0]?.type, "error");
  }
});

test("incomplete structured blocks fail only when the stream finishes", () => {
  const parser = new StructuredStreamParser();

  const initial = parser.push(
    fence +
      "learning-practice\n" +
      JSON.stringify({
        kind: "question",
        concept: "x",
        question: "unfinished",
      }),
  );

  assert.deepEqual(initial, []);

  const final = parser.finish();
  assert.deepEqual(final, [
    {
      type: "error",
      message:
        "Incomplete learning-practice block returned by the agent.",
    },
  ]);
});

test("parses <think> and <thought> tags across every stream split boundary", () => {
  for (const tag of ["think", "thought"]) {
    const payload = `<${tag}>Thinking step 1\nStep 2</${tag}>Final answer`;
    for (const events of parseAtEverySplit(payload)) {
      const merged: StructuredStreamEvent[] = [];
      for (const event of events) {
        const last = merged[merged.length - 1];
        if (event.type === "thought" && last?.type === "thought") {
          last.text += event.text;
        } else if (event.type === "text" && last?.type === "text") {
          last.text += event.text;
        } else {
          merged.push({ ...event });
        }
      }
      assert.deepEqual(merged, [
        { type: "thought", text: "Thinking step 1\nStep 2" },
        { type: "text", text: "Final answer" },
      ]);
    }
  }
});

test("streams thought chunks progressively before </think>", () => {
  const parser = new StructuredStreamParser();
  const chunk1 = parser.push("<think>Analyzing note...");
  assert.deepEqual(chunk1, [{ type: "thought", text: "Analyzing note..." }]);

  const chunk2 = parser.push(" and drafting reply</think>Here is the response");
  const final = parser.finish();
  const mergedText = [...chunk2, ...final]
    .filter((e) => e.type === "text")
    .map((e) => (e as { text: string }).text)
    .join("");

  assert.deepEqual(chunk2[0], { type: "thought", text: " and drafting reply" });
  assert.equal(mergedText, "Here is the response");
});

test("unclosed <think> flushes remaining thought text without error", () => {
  const parser = new StructuredStreamParser();
  const chunk = parser.push("<think>Thinking that didn't finish");
  const final = parser.finish();
  const total = [...chunk, ...final]
    .filter((e) => e.type === "thought")
    .map((e) => (e as { text: string }).text)
    .join("");
  assert.equal(total, "Thinking that didn't finish");
  assert.ok(![...chunk, ...final].some((e) => e.type === "error"));
});


test("accepts MCQ and code questions across every stream split and rejects invalid option references", () => {
  const valid = [
    { kind: "question", concept: "IoC", question: "Select answer",
      input: { type: "multiple-choice", options: [
        { id: "a", text: "wrong" }, { id: "b", text: "correct" },
      ], correctOptionId: "b", explanation: "Dependency resolution." } },
    { kind: "question", concept: "Java", question: "Write a service",
      input: { type: "code", language: "java", executionMode: "review-only",
        starterCode: "class Service {}", criteria: ["Constructor injection"] } },
  ];
  for (const q of valid) {
    const payload = fence + "learning-practice\n" + JSON.stringify(q) + "\n" + fence;
    for (const events of parseAtEverySplit(payload)) {
      assert.deepEqual(normalized(events), [{ type: "practice-question", question: q }]);
    }
  }
  const invalid = { ...valid[0], input: { ...valid[0].input, correctOptionId: "unknown" } };
  const parser = new StructuredStreamParser();
  const parsed = [...parser.push(fence + "learning-practice\n" + JSON.stringify(invalid) + "\n" + fence),
    ...parser.finish()];
  assert.equal(parsed.filter(event => event.type === "practice-question").length, 0);
  assert.equal(parsed.some(event => event.type === "error"), true);
});
