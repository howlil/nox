import assert from "node:assert/strict";
import test from "node:test";
import {
  StructuredStreamEvent,
  StructuredStreamParser,
} from "../../src/agent/StructuredStreamParser";

const fence = String.fromCharCode(96).repeat(3);

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
