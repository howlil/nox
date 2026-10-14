import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSign, generateKeyPairSync } from "node:crypto";
import { ChatGptAuth, verifyChatGptIdToken } from "../../src/agent/ChatGptAuth";
import { ChatGptAdapter, SseDecoder } from "../../src/agent/ChatGptAdapter";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig" };
const clientId = "oaiapp_testing";
const now = 1_792_000_000_000;
const token = (nonce: string, overrides: Record<string, unknown> = {}) => {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://auth.openai.com", aud: clientId, exp: now / 1000 + 3600,
    iat: now / 1000, nonce, sub: "subject-1", email: "user@example.com", ...overrides,
  })).toString("base64url");
  const content = header + "." + payload;
  const signed = createSign("RSA-SHA256").update(content).sign(privateKey).toString("base64url");
  return content + "." + signed;
};
const jwks = async (_url: unknown) => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });

test("OIDC verifier checks JWKS signature, audience and nonce before accepting identity", async () => {
  const good = token("abc");
  assert.deepEqual(await verifyChatGptIdToken(good, clientId, "abc", jwks as typeof fetch, now),
    { subject: "subject-1", email: "user@example.com" });
  await assert.rejects(verifyChatGptIdToken(good, clientId, "wrong", jwks as typeof fetch, now), /verification failed/);
  await assert.rejects(verifyChatGptIdToken(token("abc", { aud: "someone-else" }), clientId, "abc", jwks as typeof fetch, now));
  await assert.rejects(verifyChatGptIdToken(good.slice(0, -4) + "AAAA", clientId, "abc", jwks as typeof fetch, now));
});

test("OAuth loopback PKCE authenticates a dynamically issued client and persists credentials outside vault", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nox-siwc-"));
  const file = join(dir, "nox", "chatgpt-auth.json");
  let responseCount = 0;
  let clock = now;
  const http = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("jwks.json")) return jwks(url);
    if (url.endsWith("oauth/token")) {
      responseCount++;
      const params = new URLSearchParams(String(init?.body));
      assert.equal(params.get("client_id"), clientId);
      assert.equal(params.get("resource"), "https://api.openai.com/v1");
      if (responseCount === 1) {
        assert.equal(params.get("grant_type"), "authorization_code");
        assert.ok(params.get("code_verifier"));
      }
      return new Response(JSON.stringify({
        access_token: "access-" + responseCount, refresh_token: "refresh-" + responseCount,
        id_token: token("placeholder"), scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        token_type: "Bearer", expires_in: 3600,
      }));
    }
    throw new Error("unexpected request " + url);
  };
  try {
    const auth = new ChatGptAuth({ storageFile: file, fetch: http as typeof fetch, now: () => now });
    // Bind the JWT nonce to the actual authorization URL.
    const callbackFetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith("oauth/token")) {
        const params = new URLSearchParams(String(init?.body));
        if (params.get("grant_type") === "authorization_code") assert.ok(params.get("code_verifier"));
      }
      return http(input, init);
    };
    // Validate callback and PKCE without external network access.
    let requestUrl = "";
    const dynamicFetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith("oauth/token")) {
        const response = await callbackFetch(input, init);
        const body = await response.json() as Record<string, unknown>;
        body.id_token = token(new URL(requestUrl).searchParams.get("nonce")!);
        return new Response(JSON.stringify(body));
      }
      return jwks(input);
    };
    const running = new ChatGptAuth({ storageFile: file, fetch: dynamicFetch as typeof fetch, now: () => clock });
    let callbackPage: Promise<Response> | undefined;
    const status = await running.signIn(async (url) => {
      requestUrl = url;
      const params = new URL(url).searchParams;
      assert.equal(params.get("client_id"), "dynamic_agent_client");
      assert.equal(params.get("resource"), "https://api.openai.com/v1");
      assert.equal(params.get("code_challenge_method"), "S256");
      const callback = new URL(params.get("redirect_uri")!);
      callback.searchParams.set("state", params.get("state")!);
      callback.searchParams.set("code", "fake-auth-code");
      callback.searchParams.set("client_id", clientId);
      // Browser navigation is not awaited by Electron.shell.openExternal.
      // The callback HTTP response must wait for verified token storage.
      callbackPage = fetch(callback.toString());
    });
    assert.ok(callbackPage);
    const response = await callbackPage;
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ChatGPT connected to Nox/);
    assert.equal(status.connected, true);
    assert.equal(status.sharing, true);
    assert.equal(status.email, "user@example.com");
    assert.equal((await running.accessToken()), "access-1");
    clock += 3601 * 1000;
    assert.equal((await running.accessToken()), "access-2"); // Rotating refresh token is persisted atomically.
    assert.equal(responseCount, 2);
    const savedFileText = readFileSync(file, "utf8");
    if (process.platform === "win32") assert.equal(savedFileText.startsWith("{"), false);
    else {
      const saved = JSON.parse(savedFileText);
      assert.equal(saved.clientId, clientId);
      assert.match(saved.hostId, /^urn:uuid:/);
      assert.ok(saved.credentials.refreshToken);
    }
    const reopened = new ChatGptAuth({ storageFile: file, fetch: dynamicFetch as typeof fetch, now: () => clock });
    assert.equal(reopened.status().sharing, true);
    running.signOut();
    assert.equal(running.status().connected, false);
    const signedOut = new ChatGptAuth({ storageFile: file, fetch: dynamicFetch as typeof fetch, now: () => now });
    assert.equal(signedOut.status().connected, false);
    reopened.dispose(); signedOut.dispose();
    auth.dispose(); running.dispose();
  } finally { rmSync(dir, { force: true, recursive: true }); }
});

test("SSE parsing handles arbitrary chunk boundaries, then emits only completed Responses turns", async () => {
  const sse = new SseDecoder();
  assert.deepEqual(sse.push('event: response.output_text.delta\ndata: {"type":"response.output_'), []);
  assert.deepEqual(sse.push('text.delta","delta":"Hello"}\n\n'), [{
    event: "response.output_text.delta", data: '{"type":"response.output_text.delta","delta":"Hello"}',
  }]);
  const storageFile = join(mkdtempSync(join(tmpdir(), "nox-siwc-no-key-")), "creds.json");
  const auth = new ChatGptAuth({ storageFile });
  const fakeAuth = { status: () => ({ sharing: true }), accessToken: async () => "test-token" } as ChatGptAuth;
  let submitted: Record<string, unknown> | undefined;
  const http = async (url: unknown, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({
      models: [{ slug: "model-a", display_name: "Model A", visibility: "list" }],
    }));
    submitted = JSON.parse(String(init?.body));
    const text = 'data: {"type":"response.output_text.delta","delta":"Hi"}\n\ndata: {"type":"response.completed"}\n\ndata: [DONE]\n\n';
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(text.slice(0, 48)));
        controller.enqueue(new TextEncoder().encode(text.slice(48))); controller.close(); },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  const adapter = new ChatGptAdapter(fakeAuth, { fetch: http as typeof fetch });
  const models = await adapter.listModels();
  assert.deepEqual(models, [{ id: "model-a", name: "Model A" }]);
  const events = [];
  for await (const event of adapter.send({ prompt: "test", context: [] },
    { history: [{ role: "user", content: "Old question" }, { role: "assistant", content: "Old answer" }] },
    new AbortController().signal)) events.push(event);
  assert.deepEqual(events, [{ type: "text", content: "Hi" }, { type: "completed" }]);
  assert.equal(submitted?.store, false);
  assert.equal(submitted?.stream, true);
  assert.deepEqual((submitted?.input as Array<{ role: string }>).map((x) => x.role), ["user", "assistant", "user"]);
  assert.equal("previous_response_id" in submitted!, false);
  auth.dispose();
  rmSync(join(storageFile, ".."), { recursive: true, force: true });
});

test("truncated SSE response is not marked complete", async () => {
  const auth = { status: () => ({ sharing: true }), accessToken: async () => "token" } as ChatGptAuth;
  const adapter = new ChatGptAdapter(auth, { fetch: async (url: unknown) =>
    new Response(String(url).endsWith("/models") ? JSON.stringify({
      models: [{ slug: "m", display_name: "M", visibility: "list" }] }) :
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      { status: 200 }) as Promise<Response> as typeof fetch });
  const events = [];
  for await (const event of adapter.send({ prompt: "hi", context: [] }, {}, new AbortController().signal)) events.push(event);
  assert.equal(events[0]?.type, "text");
  assert.equal(events[1]?.type, "failed");
});

test("Windows credential corruption shows safe actionable error, never encoded PowerShell source", {
  skip: process.platform !== "win32",
}, () => {
  const dir = mkdtempSync(join(tmpdir(), "nox-invalid-dpapi-"));
  const file = join(dir, "chatgpt-auth.json");
  try {
    writeFileSync(file, "invalid-dpapi-ciphertext", "utf8");
    assert.throws(() => new ChatGptAuth({ storageFile: file }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Windows DPAPI/);
      assert.doesNotMatch(error.message, /-EncodedCommand|CLIXML|invalid-dpapi-ciphertext/);
      return true;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("browser callback never displays success when OAuth token exchange fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nox-auth-failure-"));
  const file = join(dir, "chatgpt-auth.json");
  let callbackPage: Promise<Response> | undefined;
  let exchangeStarted: (() => void) | undefined;
  let finishExchange: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { exchangeStarted = resolve; });
  const gate = new Promise<void>((resolve) => { finishExchange = resolve; });
  const http = async (url: unknown): Promise<Response> => {
    if (String(url).endsWith("/oauth/token")) {
      exchangeStarted?.();
      await gate;
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("Unexpected request");
  };
  try {
    const auth = new ChatGptAuth({ storageFile: file, fetch: http as typeof fetch });
    const attempt = auth.signIn(async (url) => {
      const requested = new URL(url);
      const callback = new URL(requested.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", requested.searchParams.get("state")!);
      callback.searchParams.set("code", "one-time-code");
      callback.searchParams.set("client_id", "oaiapp-test");
      callbackPage = fetch(callback);
    });
    await started;
    assert.ok(callbackPage);
    let browserCompleted = false;
    void callbackPage.then(() => { browserCompleted = true; });
    // The OAuth exchange is still pending, so the callback page is not complete.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(browserCompleted, false);
    finishExchange?.();
    await assert.rejects(attempt, /invalid_grant/);
    const browser = await callbackPage;
    assert.equal(browser.status, 500);
    const html = await browser.text();
    assert.match(html, /ChatGPT connection failed/);
    assert.match(html, /Exchanging the authorization code for tokens failed/);
    assert.doesNotMatch(html, /one-time-code|refresh_token|access_token/);
    assert.equal(auth.status().connected, false);
    assert.equal(auth.status().lastFailure?.stage, "token-exchange");
    assert.equal(auth.status().lastFailure?.code, "invalid_grant");
    assert.doesNotMatch(auth.status().lastFailure!.message, /one-time-code/);

    // A later reauthorization is allowed to omit client_id in its callback:
    // the issued ID from the first attempt must be reused.
    let retryPage: Promise<Response> | undefined;
    await assert.rejects(auth.signIn(async (url) => {
      const requested = new URL(url);
      assert.equal(requested.searchParams.get("client_id"), "oaiapp-test");
      const callback = new URL(requested.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", requested.searchParams.get("state")!);
      callback.searchParams.set("code", "new-code");
      retryPage = fetch(callback); // Intentionally omit client_id.
    }), /invalid_grant/);
    assert.ok(retryPage);
    assert.equal((await retryPage).status, 500);
    assert.equal(auth.status().lastFailure?.stage, "token-exchange");
    auth.dispose();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/**
 * The real OAuth service can respond with JSON OAuth errors, generic HTTP
 * errors, proxy HTML, or a successful but incomplete token payload. All must
 * produce a reproducible, secret-free diagnostic rather than request_failed.
 */
for (const scenario of [
  { name: "standard OAuth error", status: 400,
    body: '{"error":"invalid_grant","error_description":"secret-code-should-not-leak"}',
    expected: "invalid_grant" },
  { name: "nested OAuth error", status: 401,
    body: '{"error":{"code":"invalid_client","message":"secret-code-should-not-leak"}}',
    expected: "invalid_client" },
  { name: "unknown HTTP error", status: 403,
    body: '{"detail":"secret-code-should-not-leak"}', expected: "http_403" },
  { name: "HTML error from proxy", status: 502,
    body: "<html>secret-code-should-not-leak</html>", expected: "http_502_non_json" },
  { name: "malformed successful JSON", status: 200,
    body: "not-json", expected: "non_json_response" },
  { name: "missing ID token", status: 200,
    body: '{"access_token":"secret-code-should-not-leak"}', expected: "missing_id_token" },
]) {
  test("OAuth diagnostics distinguish " + scenario.name, async () => {
    const dir = mkdtempSync(join(tmpdir(), "nox-token-diagnostic-"));
    const file = join(dir, "nox", "chatgpt-auth.json");
    let callbackPage: Promise<Response> | undefined;
    const http = async (): Promise<Response> =>
      new Response(scenario.body, { status: scenario.status });
    try {
      const auth = new ChatGptAuth({ storageFile: file, fetch: http as typeof fetch });
      const attempt = auth.signIn(async (url) => {
        const u = new URL(url);
        const callback = new URL(u.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "private-one-time-code");
        callback.searchParams.set("state", u.searchParams.get("state")!);
        callback.searchParams.set("client_id", "oaiapp-test");
        callbackPage = fetch(callback);
      });
      await assert.rejects(attempt);
      assert.equal(auth.status().lastFailure?.stage, "token-exchange");
      assert.equal(auth.status().lastFailure?.code, scenario.expected);
      const page = await callbackPage!;
      assert.equal(page.status, 500);
      const body = await page.text();
      assert.match(body, new RegExp(scenario.expected));
      assert.doesNotMatch(body, /private-one-time-code|secret-code-should-not-leak/);
      assert.doesNotMatch(auth.status().lastFailure?.message || "",
        /private-one-time-code|secret-code-should-not-leak/);
      auth.dispose();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("OAuth network failure produces network_error without including connection diagnostics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nox-network-"));
  const file = join(dir, "chatgpt-auth.json");
  let callbackPage: Promise<Response> | undefined;
  try {
    const auth = new ChatGptAuth({ storageFile: file, fetch: (async () => {
      throw new TypeError("fetch failed: private-one-time-code");
    }) as typeof fetch });
    const attempt = auth.signIn(async (url) => {
      const u = new URL(url);
      const callback = new URL(u.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", u.searchParams.get("state")!);
      callback.searchParams.set("code", "private-one-time-code");
      callback.searchParams.set("client_id", "oaiapp-test");
      callbackPage = fetch(callback);
    });
    await assert.rejects(attempt);
    assert.equal(auth.status().lastFailure?.code, "network_error");
    assert.doesNotMatch(auth.status().lastFailure?.message || "", /private-one-time-code/);
    assert.equal((await callbackPage!).status, 500);
    auth.dispose();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("ChatGPT response.completed carries provider-reported usage into the runtime boundary", async () => {
  const auth = { status: () => ({ sharing: true }), accessToken: async () => "token" } as ChatGptAuth;
  const body = 'data: ' + JSON.stringify({
    type: "response.completed",
    response: {
      model: "gpt-6",
      usage: { input_tokens: 240, output_tokens: 60, total_tokens: 300,
        input_tokens_details: { cached_tokens: 80 },
        output_tokens_details: { reasoning_tokens: 20 } },
    },
  }) + '\n\ndata: [DONE]\n\n';
  const adapter = new ChatGptAdapter(auth, { fetch: async (url: unknown) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({
      models: [{ slug: "gpt-6", display_name: "GPT-6", visibility: "list" }],
    }));
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  } as typeof fetch });
  const events = [];
  for await (const event of adapter.send({ prompt: "test", context: [] }, { model: "gpt-6" },
    new AbortController().signal)) events.push(event);
  assert.deepEqual(events, [
    { type: "usage", model: "gpt-6", usage: {
      inputTokens: 240, outputTokens: 60, totalTokens: 300,
      cachedInputTokens: 80, reasoningTokens: 20,
    } },
    { type: "completed" },
  ]);
});
