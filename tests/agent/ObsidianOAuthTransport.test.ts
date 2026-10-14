import assert from "node:assert/strict";
import test from "node:test";
import { createObsidianOAuthFetch, type ObsidianOAuthRequest } from "../../src/agent/ObsidianOAuthTransport";

const tokenUrl = "https://auth.openai.com/api/accounts/oauth/token";
const keysUrl = "https://auth.openai.com/.well-known/jwks.json";

test("uses Obsidian requestUrl with form body and safe 4xx passthrough", async () => {
  const sent: ObsidianOAuthRequest[] = [];
  const fetchOAuth = createObsidianOAuthFetch(async (input) => {
    sent.push(input);
    return { status: 400, text: '{"error":"invalid_grant"}' };
  });
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "oaiapp-test",
    code: "confidential-code",
    code_verifier: "pkce",
  }).toString();
  const response = await fetchOAuth(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body,
  });
  assert.equal(response.status, 400);
  assert.equal(response.ok, false);
  assert.deepEqual(await response.json(), { error: "invalid_grant" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, tokenUrl);
  assert.equal(sent[0].method, "POST");
  assert.equal(sent[0].throw, false);
  assert.equal(sent[0].body, body);
  assert.equal(sent[0].headers?.["content-type"], "application/x-www-form-urlencoded");
});

test("JWKS request stays GET and retains JSON body", async () => {
  const fetchOAuth = createObsidianOAuthFetch(async (input) => {
    assert.equal(input.url, keysUrl);
    assert.equal(input.method, "GET");
    assert.equal(input.body, undefined);
    return { status: 200, text: '{"keys":[]}' };
  });
  const response = await fetchOAuth(keysUrl);
  assert.deepEqual(await response.json(), { keys: [] });
});

test("blocks redirection of OAuth secrets to other hosts, paths, or query strings", async () => {
  let requests = 0;
  const fetchOAuth = createObsidianOAuthFetch(async () => {
    requests++;
    return { status: 200, text: "{}" };
  });
  for (const bad of [
    "https://auth.openai.com.evil.example/api/accounts/oauth/token",
    "http://auth.openai.com/api/accounts/oauth/token",
    "https://auth.openai.com/unknown",
    tokenUrl + "?redirect=https://evil.example/",
    "https://someone@auth.openai.com/api/accounts/oauth/token",
  ]) {
    await assert.rejects(fetchOAuth(bad, { method: "POST", body: "code=secret" }));
  }
  await assert.rejects(fetchOAuth(keysUrl, { method: "POST", body: "code=secret" }));
  assert.equal(requests, 0);
});

test("aborted OAuth requests stop waiting without duplicating the code exchange", async () => {
  const controller = new AbortController();
  let requests = 0;
  const fetchOAuth = createObsidianOAuthFetch(async () => {
    requests++;
    return new Promise(() => {}); // Obsidian requestUrl itself is not cancellable.
  });
  const wait = fetchOAuth(tokenUrl, {
    method: "POST", body: "code=once", signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(wait, (error: unknown) =>
    error instanceof Error && error.name === "AbortError");
  assert.equal(requests, 1);
});

test("does not issue a request when already aborted", async () => {
  let requests = 0;
  const controller = new AbortController();
  controller.abort();
  const fetchOAuth = createObsidianOAuthFetch(async () => {
    requests++; return { status: 200, text: "{}" };
  });
  await assert.rejects(fetchOAuth(keysUrl, { signal: controller.signal }));
  assert.equal(requests, 0);
});
