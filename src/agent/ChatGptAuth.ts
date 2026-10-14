import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { dirname, join } from "path";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const TOKEN_URL = ISSUER + "/api/accounts/oauth/token";
const AUTH_URL = ISSUER + "/api/accounts/authorize";
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PERMISSION = "chatgpt.tokens.use.direct";

type Credentials = {
  clientId: string;
  subject: string;
  email?: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: number;
  earliestRefreshAt: number;
};

type RecordOnDisk = { hostId: string; clientId?: string; credentials?: Credentials };

export type ChatGptConnection = {
  connected: boolean;
  sharing: boolean;
  email?: string;
  description: string;
};

export interface ChatGptAuthDeps {
  fetch: typeof fetch;
  now: () => number;
  storageFile: string;
}

function storagePath(): string {
  const root = process.platform === "win32"
    ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(root, "nox", "chatgpt-auth.json");
}

function randomBase64Url(): string {
  return randomBytes(32).toString("base64url");
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ChatGPT returned an invalid object.");
  }
  return value as Record<string, unknown>;
}

/** Verify OIDC issuer, RS256 signature, audience, expiry, and nonce before accepting identity. */
export async function verifyChatGptIdToken(
  token: string, clientId: string, nonce: string, http: typeof fetch = fetch, now = Date.now(),
): Promise<{ subject: string; email?: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid ChatGPT ID token.");
  const header = object(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported ChatGPT identity signing algorithm.");
  }
  const keysResponse = await http(ISSUER + "/.well-known/jwks.json");
  if (!keysResponse.ok) throw new Error("Unable to verify ChatGPT identity.");
  const jwks = object(await keysResponse.json());
  if (!Array.isArray(jwks.keys)) throw new Error("Invalid ChatGPT signing keys.");
  const key = jwks.keys.find((item: unknown) => {
    const candidate = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return candidate.kid === header.kid && candidate.kty === "RSA" &&
      (candidate.use === undefined || candidate.use === "sig");
  });
  if (!key) throw new Error("Unknown ChatGPT identity signing key.");
  const valid = verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]),
    createPublicKey({ key: key as import("crypto").JsonWebKey, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!valid) throw new Error("Invalid ChatGPT identity signature.");
  const claims = object(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")));
  const audience = claims.aud;
  if (claims.iss !== ISSUER || !(audience === clientId ||
      (Array.isArray(audience) && audience.includes(clientId))) ||
      typeof claims.exp !== "number" || claims.exp * 1000 < now - 5000 ||
      (typeof claims.nbf === "number" && claims.nbf * 1000 > now + 5000) ||
      (typeof claims.iat === "number" && claims.iat * 1000 > now + 5000) ||
      (Array.isArray(audience) && audience.length > 1 && claims.azp !== clientId) ||
      claims.nonce !== nonce || typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("ChatGPT identity verification failed.");
  }
  return { subject: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined };
}

/**
 * Windows DPAPI protects secrets for the current OS user. The token itself
 * travels only over stdin and never appears in a command argument.
 * Unix uses the official OSS integration's 0600 owner-only local file model.
 */
function credentialFileText(value: string, encrypt: boolean): string {
  if (process.platform !== "win32") return value;
  const script = encrypt
    ? '$bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());' +
      '$secret=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
      '[Console]::Out.Write([Convert]::ToBase64String($secret))'
    : '$data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());' +
      '$plain=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
      '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))';
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    input: value, encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true,
  }).trim();
}

/** Local OSS OAuth public client. No ChatGPT tokens are stored in the Obsidian vault. */
export class ChatGptAuth {
  private record: RecordOnDisk;
  private readonly deps: ChatGptAuthDeps;
  private listener?: Server;
  private activeLogin = false;
  private refreshPending?: Promise<string>;

  constructor(deps: Partial<ChatGptAuthDeps> = {}) {
    this.deps = { fetch, now: Date.now, storageFile: storagePath(), ...deps };
    if (existsSync(this.deps.storageFile)) {
      const disk = object(JSON.parse(credentialFileText(readFileSync(this.deps.storageFile, "utf8"), false)));
      this.record = {
        hostId: typeof disk.hostId === "string" && disk.hostId.startsWith("urn:uuid:")
          ? disk.hostId : "urn:uuid:" + randomUUID(),
        clientId: typeof disk.clientId === "string" ? disk.clientId : undefined,
        credentials: disk.credentials && typeof disk.credentials === "object"
          ? disk.credentials as Credentials : undefined,
      };
    } else this.record = { hostId: "urn:uuid:" + randomUUID() };
  }

  private save(): void {
    const file = this.deps.storageFile;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temp = file + "." + randomBytes(8).toString("hex") + ".tmp";
    writeFileSync(temp, credentialFileText(JSON.stringify(this.record), true), { encoding: "utf8", mode: 0o600 });
    renameSync(temp, file);
  }

  status(): ChatGptConnection {
    const c = this.record.credentials;
    if (!c) return { connected: false, sharing: false, description: "Sign in with ChatGPT to use your plan." };
    const sharing = c.scopes.includes(PERMISSION);
    return { connected: true, sharing, email: c.email,
      description: sharing ? "Connected with ChatGPT plan access."
        : "Connected, but ChatGPT plan access was not granted. Reauthorize." };
  }

  async signIn(openBrowser: (url: string) => Promise<void>): Promise<ChatGptConnection> {
    if (this.activeLogin) throw new Error("A ChatGPT sign-in is already active.");
    this.activeLogin = true;
    const state = randomBase64Url(), nonce = randomBase64Url(), verifier = randomBase64Url();
    const server = createServer();
    let callbackTimeout: ReturnType<typeof setTimeout> | undefined;
    this.listener = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to start ChatGPT callback.");
      const redirectUri = "http://127.0.0.1:" + address.port + "/auth/callback";
      if (!existsSync(this.deps.storageFile)) this.save(); // Persist host identity before initial registration.
      const knownClient = this.record.clientId;
      const url = new URL(AUTH_URL);
      url.searchParams.set("client_id", knownClient || "dynamic_agent_client");
      url.searchParams.set("ext_agent_host_id", this.record.hostId);
      if (!knownClient) url.searchParams.set("agent_name_hint", "Nox");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", SCOPE);
      url.searchParams.set("resource", RESOURCE);
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
      if (this.record.credentials && !this.record.credentials.scopes.includes(PERMISSION)) {
        url.searchParams.set("prompt", "consent"); // Only when enabling a previously declined permission.
      }

      const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
        callbackTimeout = setTimeout(() => reject(new Error("ChatGPT sign-in timed out.")), 180000);
        server.on("request", (req, res) => {
          const target = new URL(req.url || "/", redirectUri);
          if (req.method !== "GET" || target.pathname !== "/auth/callback" ||
              !["127.0.0.1", "127.0.0.1:" + address.port].includes(req.headers.host || "")) {
            res.writeHead(404).end(); return;
          }
          const rejectOnce = (message: string) => { if (callbackTimeout) clearTimeout(callbackTimeout); reject(new Error(message)); };
          if (target.searchParams.get("state") !== state) {
            res.writeHead(400).end("Invalid sign-in state."); rejectOnce("ChatGPT sign-in state did not match."); return;
          }
          const code = target.searchParams.get("code");
          const returned = target.searchParams.get("client_id");
          const clientId = knownClient || returned;
          if (target.searchParams.has("error") || !code || !clientId ||
              clientId === "dynamic_agent_client" || (knownClient && returned && returned !== knownClient)) {
            res.writeHead(400).end("ChatGPT sign-in was declined or invalid.");
            rejectOnce("ChatGPT sign-in was declined or returned an invalid client."); return;
          }
          if (callbackTimeout) clearTimeout(callbackTimeout);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
            .end("<!doctype html><title>Nox</title><p>Authentication received. Return to Obsidian.</p>");
          resolve({ code, clientId });
        });
      });
      // Keep the rejection observed even if opening the browser itself fails.
      void callback.catch(() => {});
      await openBrowser(url.toString());
      const result = await callback;
      if (this.record.clientId && this.record.clientId !== result.clientId) {
        throw new Error("ChatGPT returned a different registration.");
      }
      this.record.clientId = result.clientId;
      this.save(); // Issued client ID survives a later expired authorization code.
      const response = await this.tokenRequest(new URLSearchParams({
        grant_type: "authorization_code", client_id: result.clientId,
        code: result.code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE,
      }));
      const idToken = typeof response.id_token === "string" ? response.id_token : "";
      if (!idToken) throw new Error("ChatGPT did not issue an ID token.");
      const identity = await verifyChatGptIdToken(idToken, result.clientId, nonce, this.deps.fetch, this.deps.now());
      if (this.record.credentials && this.record.credentials.subject !== identity.subject) {
        throw new Error("This registration belongs to a different ChatGPT account.");
      }
      this.record.credentials = this.credentialFrom(response, result.clientId, identity.subject, identity.email, idToken);
      this.save();
      return this.status();
    } finally {
      if (callbackTimeout) clearTimeout(callbackTimeout);
      this.activeLogin = false;
      server.close();
      if (this.listener === server) this.listener = undefined;
    }
  }

  private async tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
    const result = await this.deps.fetch(TOKEN_URL, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const data = object(await result.json());
    if (!result.ok) {
      const error = typeof data.error === "string" ? data.error : "token_request_failed";
      throw new Error("ChatGPT OAuth failed: " + error);
    }
    return data;
  }

  private credentialFrom(data: Record<string, unknown>, clientId: string, subject: string,
    email: string | undefined, idToken: string, old?: Credentials): Credentials {
    if (typeof data.access_token !== "string" || !data.access_token ||
        (typeof data.refresh_token !== "string" && !old) ||
        (data.token_type !== undefined && String(data.token_type).toLowerCase() !== "bearer")) {
      throw new Error("ChatGPT returned incomplete OAuth credentials.");
    }
    const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : old?.scopes || [];
    const expires = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
    const now = this.deps.now();
    return { clientId, subject, email, idToken, accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : old!.refreshToken,
      scopes, expiresAt: now + expires * 1000,
      earliestRefreshAt: typeof data.earliest_refresh_at === "number"
        ? data.earliest_refresh_at * 1000 : now };
  }

  async accessToken(): Promise<string> {
    const c = this.record.credentials;
    if (!c || !c.scopes.includes(PERMISSION)) throw new Error("Sign in and enable ChatGPT plan access in Nox settings.");
    if (this.deps.now() < c.expiresAt - 60000) return c.accessToken;
    if (this.refreshPending) return this.refreshPending;
    this.refreshPending = (async () => {
      if (this.deps.now() < c.earliestRefreshAt && this.deps.now() < c.expiresAt) return c.accessToken;
      const result = await this.tokenRequest(new URLSearchParams({
        grant_type: "refresh_token", client_id: c.clientId,
        refresh_token: c.refreshToken, resource: RESOURCE,
      }));
      const updated = this.credentialFrom(result, c.clientId, c.subject, c.email, c.idToken, c);
      if (!updated.scopes.includes(PERMISSION)) throw new Error("ChatGPT plan permission was revoked. Sign in again.");
      this.record.credentials = updated;
      this.save();
      return updated.accessToken;
    })();
    try { return await this.refreshPending; }
    catch (error) {
      if (error instanceof Error && /invalid_grant|invalid_refresh_token|refresh_token_invalidated|refresh_token_expired|refresh_token_reused|token_expired/i.test(error.message)) {
        this.record.credentials = undefined; this.save();
      }
      throw error;
    } finally { this.refreshPending = undefined; }
  }

  signOut(): void {
    if (this.activeLogin) throw new Error("Finish sign-in before disconnecting.");
    this.record.credentials = undefined;
    // Retain the issued client ID to let the same user reauthorize without a new registration.
    this.save();
  }

  dispose(): void { this.listener?.close(); }
}
