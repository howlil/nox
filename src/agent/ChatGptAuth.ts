import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createServer, type Server, type ServerResponse } from "http";
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

export type ChatGptAuthStage = "registration-storage" | "browser-launch" | "callback" |
  "token-exchange" | "identity-validation" | "credentials-storage";

export type ChatGptAuthFailure = {
  stage: ChatGptAuthStage;
  code: string;
  message: string;
};

export type ChatGptConnection = {
  connected: boolean;
  sharing: boolean;
  email?: string;
  description: string;
  lastFailure?: ChatGptAuthFailure;
};

/**
 * Never persist raw exceptions, request URLs, authorization codes, or tokens.
 * Only a bounded, preapproved error category may enter the UI/browser.
 */
function signInFailure(stage: ChatGptAuthStage, cause: unknown): ChatGptAuthFailure {
  const text = cause instanceof Error ? cause.message : "";
  const oauth = /^ChatGPT OAuth failed: ([a-z][a-z0-9_]{0,47})$/.exec(text)?.[1];
  const known = new Set(["invalid_grant", "invalid_request", "invalid_client", "unauthorized_client",
    "access_denied", "invalid_scope", "unsupported_grant_type", "server_error",
    "temporarily_unavailable", "interaction_required", "consent_required"]);
  const code = oauth && known.has(oauth) ? oauth
    : /DPAPI|System.Security|encrypt|decrypt/i.test(text) ? "credential_protection_failed"
    : /timed out|AbortError|aborted/i.test(text) ? "timeout"
    : /fetch failed|network|ECONN|ENOTFOUND/i.test(text) ? "network_error"
    : stage === "identity-validation" ? "identity_verification_failed"
    : stage === "callback" ? "callback_rejected"
    : "request_failed";
  const labels: Record<ChatGptAuthStage, string> = {
    "registration-storage": "Saving the ChatGPT client registration",
    "browser-launch": "Opening ChatGPT sign-in in the browser",
    "callback": "Receiving the ChatGPT authorization callback",
    "token-exchange": "Exchanging the authorization code for tokens",
    "identity-validation": "Verifying the ChatGPT account identity",
    "credentials-storage": "Saving the verified ChatGPT credentials",
  };
  const advice = code === "invalid_grant"
    ? "Start a new sign-in; authorization codes can expire or be used only once."
    : code === "credential_protection_failed"
      ? "Check Windows DPAPI and local credential storage."
      : code === "network_error" || code === "timeout"
        ? "Check connectivity and retry with a new sign-in."
        : "Retry sign-in; if it persists, report this stage and code only.";
  return { stage, code, message: labels[stage] + " failed (" + code + "). " + advice };
}

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
  // Windows PowerShell 5.1 doesn't automatically load System.Security.dll,
  // which contains ProtectedData on .NET Framework. Without this line the
  // first sign-in fails before the browser can open.
  const setup = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security -ErrorAction Stop;";
  const script = setup + (encrypt
    ? '$bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());' +
      '$secret=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
      '[Console]::Out.Write([Convert]::ToBase64String($secret))'
    : '$data=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());' +
      '$plain=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);' +
      '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))');
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      input: value, encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true,
    }).trim();
  } catch {
    // execFileSync errors echo the whole encoded PowerShell command. Never
    // expose that diagnostic (or stdin payload) in an Obsidian notice.
    throw new Error(
      "Nox could not " + (encrypt ? "encrypt" : "decrypt") +
      " ChatGPT credentials with Windows DPAPI. Check Windows PowerShell " +
      "and the .NET Framework System.Security assembly.",
    );
  }
}

/** Local OSS OAuth public client. No ChatGPT tokens are stored in the Obsidian vault. */
export class ChatGptAuth {
  private record: RecordOnDisk;
  private readonly deps: ChatGptAuthDeps;
  private listener?: Server;
  private activeLogin = false;
  private refreshPending?: Promise<string>;
  private lastFailure?: ChatGptAuthFailure;

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
    if (!c) return { connected: false, sharing: false,
      description: "Sign in with ChatGPT to use your plan.", lastFailure: this.lastFailure };
    const sharing = c.scopes.includes(PERMISSION);
    return { connected: true, sharing, email: c.email,
      description: sharing ? "Connected with ChatGPT plan access."
        : "Connected, but ChatGPT plan access was not granted. Reauthorize.",
      lastFailure: this.lastFailure };
  }

  async signIn(openBrowser: (url: string) => Promise<void>): Promise<ChatGptConnection> {
    if (this.activeLogin) throw new Error("A ChatGPT sign-in is already active.");
    this.activeLogin = true;
    const state = randomBase64Url(), nonce = randomBase64Url(), verifier = randomBase64Url();
    const server = createServer();
    let callbackTimeout: ReturnType<typeof setTimeout> | undefined;
    let pendingResponse: ServerResponse | undefined;
    let stage: ChatGptAuthStage = "registration-storage";
    // The browser may display success only once the code has been exchanged,
    // the OIDC identity validated, and the credentials durably persisted.
    const finishBrowser = (success: boolean) => {
      const res = pendingResponse;
      if (!res || res.writableEnded) return;
      const title = success ? "ChatGPT connected to Nox" : "ChatGPT connection failed";
      const diagnostic = this.lastFailure;
      const message = success
        ? "Authentication is complete. You can close this tab and return to Obsidian."
        : "Sign-in could not finish. " +
          (diagnostic ? diagnostic.message : "Return to Nox Settings and try again.");
      const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Nox — ChatGPT sign-in</title><style>' +
        'body{font:16px system-ui,sans-serif;max-width:540px;margin:12vh auto;padding:0 24px;' +
        'color:#252525;background:#fcfcfc;line-height:1.6}h1{font-size:24px;line-height:1.3}' +
        'p{color:#555}small{color:#777}</style></head><body><main><h1>' +
        title + '</h1><p>' + message +
        '</p><small>Nox · Obsidian learning companion</small></main></body></html>';
      res.writeHead(success ? 200 : 500, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(html);
    };
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
          if (pendingResponse) {
            res.writeHead(409, { "Cache-Control": "no-store" }).end("Sign-in callback already received.");
            return;
          }
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
          pendingResponse = res;
          resolve({ code, clientId });
        });
      });
      // Keep the rejection observed even if opening the browser itself fails.
      void callback.catch(() => {});
      stage = "browser-launch";
      await openBrowser(url.toString());
      stage = "callback";
      const result = await callback;
      if (this.record.clientId && this.record.clientId !== result.clientId) {
        throw new Error("ChatGPT returned a different registration.");
      }
      this.record.clientId = result.clientId;
      stage = "registration-storage";
      this.save(); // Issued client ID survives a later expired authorization code.
      stage = "token-exchange";
      const response = await this.tokenRequest(new URLSearchParams({
        grant_type: "authorization_code", client_id: result.clientId,
        code: result.code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE,
      }));
      const idToken = typeof response.id_token === "string" ? response.id_token : "";
      if (!idToken) throw new Error("ChatGPT did not issue an ID token.");
      stage = "identity-validation";
      const identity = await verifyChatGptIdToken(idToken, result.clientId, nonce, this.deps.fetch, this.deps.now());
      if (this.record.credentials && this.record.credentials.subject !== identity.subject) {
        throw new Error("This registration belongs to a different ChatGPT account.");
      }
      stage = "token-exchange"; // Validate the returned credential shape.
      const nextCredentials = this.credentialFrom(response, result.clientId, identity.subject, identity.email, idToken);
      stage = "credentials-storage";
      const priorCredentials = this.record.credentials;
      this.record.credentials = nextCredentials;
      try { this.save(); }
      catch (error) {
        // A failed disk write must not make NOX report a connected account.
        this.record.credentials = priorCredentials;
        throw error;
      }
      this.lastFailure = undefined;
      finishBrowser(true);
      return this.status();
    } catch (error) {
      // Only approved, low-entropy diagnostic codes are exposed. Raw URL/token
      // request or HTTP exception bodies are never shown or logged.
      this.lastFailure = signInFailure(stage, error);
      finishBrowser(false);
      throw new Error(this.lastFailure.message);
    } finally {
      if (callbackTimeout) clearTimeout(callbackTimeout);
      this.activeLogin = false;
      server.close();
      if (this.listener === server) this.listener = undefined;
    }
  }

  private async tokenRequest(body: URLSearchParams): Promise<Record<string, unknown>> {
    const result = await this.deps.fetch(TOKEN_URL, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(), signal: AbortSignal.timeout(30000) });
    const data = object(await result.json());
    if (!result.ok) {
      const rawCode = typeof data.error === "string" ? data.error : "";
      const code = /^[a-z][a-z0-9_]{0,47}$/.test(rawCode) ? rawCode : "oauth_error";
      throw new Error("ChatGPT OAuth failed: " + code);
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
