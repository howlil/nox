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
      const response = await fetch(callback.toString());
      assert.equal(response.status, 200);
    });
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
