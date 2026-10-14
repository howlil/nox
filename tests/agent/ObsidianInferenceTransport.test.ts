import assert from "node:assert/strict";
import test from "node:test";
import { createObsidianInferenceFetch } from "../../src/agent/ObsidianInferenceTransport";
import { ChatGptAdapter, SseDecoder } from "../../src/agent/ChatGptAdapter";
import type { ChatGptAuth } from "../../src/agent/ChatGptAuth";
import type { ObsidianOAuthRequest } from "../../src/agent/ObsidianOAuthTransport";

const BASE = "https://api.openai.com";
const models = BASE + "/v1/models";
const responses = BASE + "/v1/responses";
const auth = { status: () => ({ sharing: true }),
  accessToken: async () => "private-bearer-credential" } as ChatGptAuth;

test("model discovery uses Obsidian HTTP transport and renders account model catalog", async () => {
  const calls: ObsidianOAuthRequest[] = [];
  const http = createObsidianInferenceFetch(async (request) => {
    calls.push(request);
    return { status: 200, text: JSON.stringify({
      models: [
        { slug: "gpt-model-a", display_name: "Model A", visibility: "list" },
        { slug: "gpt-hidden", display_name: "Hidden", visibility: "hidden" },
        { slug: "gpt-model-b", display_name: "Model B", visibility: "list" },
      ],
    }) };
  });
  const adapter = new ChatGptAdapter(auth, { fetch: http });
  assert.deepEqual(await adapter.listModels(), [
    { id: "gpt-model-a", name: "Model A" }, { id: "gpt-model-b", name: "Model B" },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, models);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].throw, false);
  assert.equal(calls[0].headers?.authorization, "Bearer private-bearer-credential");
});

test("buffered SSE inference validates completion and does not call global window.fetch", async () => {
  const requests: ObsidianOAuthRequest[] = [];
  const complete = [
    'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
    'data: {"type":"response.output_text.delta","delta":" there"}\n\n',
    'data: {"type":"response.completed"}\n\n', "data: [DONE]\n\n",
  ].join("");
  const http = createObsidianInferenceFetch(async (request) => {
    requests.push(request);
    if (request.url === models) return { status: 200, text: JSON.stringify({
      models: [{ slug: "gpt-model-a", display_name: "Model A", visibility: "list" }],
    }) };
    assert.equal(request.url, responses);
    return { status: 200, text: complete };
  });
  const adapter = new ChatGptAdapter(auth, { fetch: http });
  const events = [];
  for await (const item of adapter.send({ prompt: "Hello", context: [] }, {
    history: [{ role: "assistant", content: "Prior reply" }],
  }, new AbortController().signal)) events.push(item);
  assert.deepEqual(events, [
    { type: "text", content: "Hello" },
    { type: "text", content: " there" },
    { type: "completed" },
  ]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].headers?.accept, "text/event-stream");
  const data = JSON.parse(requests[1].body!) as Record<string, unknown>;
  assert.equal(data.model, "gpt-model-a");
  assert.equal(data.store, false);
  assert.equal(data.stream, true);
});

test("SSE decoder accepts many small events when delivered as one multi-megabyte chunk", () => {
  const sse = new SseDecoder();
  const event = 'data: {"type":"response.output_text.delta","delta":"x"}\n\n';
  const chunk = event.repeat(22000); // Over 1 MB, but each event is bounded.
  const parsed = sse.push(chunk);
  assert.equal(parsed.length, 22000);
  assert.equal(JSON.parse(parsed[0].data).delta, "x");
  assert.equal(JSON.parse(parsed.at(-1)!.data).delta, "x");
});

test("blocked destinations never receive OAuth plan bearer token", async () => {
  let count = 0;
  const http = createObsidianInferenceFetch(async () => {
    count++;
    return { status: 200, text: "{}" };
  });
  const invalid = [
    BASE + "/v1/other",
    "http://api.openai.com/v1/responses",
    "https://api.openai.com.evil.test/v1/responses",
    responses + "?dest=evil",
    "https://attacker@api.openai.com/v1/responses",
  ];
  for(const url of invalid) {
    await assert.rejects(http(url, { method: "POST",
      body: "secret", headers: { Authorization: "Bearer PRIVATE" } }));
  }
  await assert.rejects(http(models, { method: "POST", body: "{}" }));
  assert.equal(count, 0);
});

test("HTTP failure is propagated to inference with HTTP status and does not become successful turn", async () => {
  const http = createObsidianInferenceFetch(async () => ({
    status: 403, text: '{"error":{"code":"subscription_sharing_usage_unavailable"}}',
  }));
  const adapter = new ChatGptAdapter(auth, { fetch: http });
  const events = [];
  for await(const item of adapter.send({ prompt: "test", context: [] },
    { model: "gpt-model-a" }, new AbortController().signal)) events.push(item);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "failed");
  if (events[0].type === "failed") {
    assert.equal(events[0].failure.code, "runtime-unavailable");
    assert.match(events[0].failure.message, /HTTP 403/);
  }
});

test("cancel before request prevents network call", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  let calls = 0;
  const http = createObsidianInferenceFetch(async () => {
    calls++;
    return { status: 200, text: "{}" };
  });
  await assert.rejects(http(models, { signal: ctrl.signal }));
  assert.equal(calls, 0);
});

test("aborted pending request does not get reissued", async () => {
  let requests = 0;
  const http = createObsidianInferenceFetch(async () => {
    requests++;
    return new Promise(() => {});
  });
  const controller = new AbortController();
  const wait = http(responses, { method: "POST", body: "{}",
    signal: controller.signal });
  controller.abort();
  await assert.rejects(wait, (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(requests, 1);
});
