import assert from "node:assert/strict";
import test from "node:test";
import { createNodeInferenceFetch } from "../../src/agent/NodeInferenceTransport";

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
