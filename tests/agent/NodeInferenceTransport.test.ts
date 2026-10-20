import assert from "node:assert/strict";
import test from "node:test";
import { createNodeInferenceFetch } from "../../src/agent/NodeInferenceTransport";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

type TestRequest = EventEmitter & { end(): void; destroy(error: Error): TestRequest };
function fakeHttps(behavior: (req: TestRequest, respond: (stream: PassThrough, status?: number) => void) => void): typeof httpsRequest {
  return ((_url: URL, _options: unknown, onResponse: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as TestRequest;
    let active: PassThrough | undefined;
    req.destroy = (error: Error) => {
      active?.destroy(error);
      req.emit("error", error);
      req.emit("close");
      return req;
    };
    req.end = () => queueMicrotask(() => behavior(req, (stream, status = 200) => {
      active = stream;
      Object.assign(stream, { statusCode: status,
        headers: { "content-type": "text/event-stream" } });
      onResponse(stream as unknown as IncomingMessage);
    }));
    return req;
  }) as unknown as typeof httpsRequest;
}


test("native inference transport is restricted to official endpoints", async () => {
  const transport = createNodeInferenceFetch(async () => new Response('{"models":[]}', { status: 200 }));
  await assert.rejects(transport("https://attacker.example/v1/responses", {
    method: "POST", body: "{}", headers: { Authorization: "Bearer secret" },
  }), /Unsupported/);
  await assert.rejects(transport("https://api.openai.com/v1/responses?redirect=https://bad.example", {
    method: "POST", body: "{}",
  }), /Unsupported/);
  await assert.rejects(transport("https://api.openai.com/v1/responses", {
    method: "POST", body: new Blob(["{}"]) as unknown as string,
  }), /JSON request body/);
});

test("model discovery retains the buffered Obsidian transport", async () => {
  let calls = 0;
  const transport = createNodeInferenceFetch(async () => {
    calls++;
    return new Response('{"models":[]}', { status: 200 });
  });
  const result = await transport("https://api.openai.com/v1/models", { method: "GET" });
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
});

test("Node HTTPS emits incremental SSE bytes and a complete terminal event", async () => {
  const payload = 'data: {"type":"response.output_text.delta","delta":"Hello"}\\n\\n'
    + 'data: {"type":"response.completed","response":{}}\\n\\n';
  const transport = createNodeInferenceFetch(async () => { throw new Error("Unexpected buffered call"); },
    fakeHttps((_req, respond) => {
      const stream = new PassThrough();
      respond(stream);
      queueMicrotask(() => {
        stream.write(payload.slice(0, 15));
        stream.end(payload.slice(15));
      });
    }));
  const result = await transport("https://api.openai.com/v1/responses", {
    method: "POST", body: '{"model":"test"}', headers: { Authorization: "Bearer private" },
  });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), payload);
});

test("Node HTTPS cancellation closes the active stream, never retries POST", async () => {
  const abort = new AbortController();
  let requests = 0;
  const transport = createNodeInferenceFetch(async () => { throw new Error("Unexpected buffered call"); },
    fakeHttps((_req, respond) => {
      requests++;
      respond(new PassThrough());
    }));
  const response = await transport("https://api.openai.com/v1/responses", {
    method: "POST", body: "{}", signal: abort.signal,
  });
  const read = response.text();
  abort.abort();
  await assert.rejects(read, /Inference cancelled|AbortError/);
  assert.equal(requests, 1);
});

test("Node HTTPS timeout rejects an in-flight request without retry", async () => {
  let requests = 0;
  const transport = createNodeInferenceFetch(async () => { throw new Error("Unexpected buffered call"); },
    fakeHttps((req) => {
      requests++;
      req.emit("timeout");
    }));
  await assert.rejects(transport("https://api.openai.com/v1/responses", {
    method: "POST", body: "{}",
  }), /inference timed out/);
  assert.equal(requests, 1);
});

test("Node HTTPS incomplete connection is an error, not a successful SSE completion", async () => {
  const transport = createNodeInferenceFetch(async () => { throw new Error("Unexpected buffered call"); },
    fakeHttps((_req, respond) => {
      const stream = new PassThrough();
      respond(stream);
      queueMicrotask(() => {
        stream.write('data: {"type":"response.output_text.delta","delta":"partial"}\\n\\n');
        stream.destroy();
      });
    }));
  const response = await transport("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });
  await assert.rejects(response.text(), /closed before terminal SSE/);
});

test("Node HTTPS response size guard rejects over 16 MiB", async () => {
  const transport = createNodeInferenceFetch(async () => { throw new Error("Unexpected buffered call"); },
    fakeHttps((_req, respond) => {
      const stream = new PassThrough();
      respond(stream);
      queueMicrotask(() => stream.write(Buffer.alloc(16 * 1024 * 1024 + 1)));
    }));
  const response = await transport("https://api.openai.com/v1/responses", { method: "POST", body: "{}" });
  await assert.rejects(response.text(), /exceeded 16 MiB/);
});
