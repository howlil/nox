/**
 * ChatGPT OAuth transport for Obsidian desktop.
 *
 * Node/Electron global fetch and the system browser can use different proxy,
 * TLS, and DNS configuration. Obsidian requestUrl is the supported plugin HTTP
 * API; keep network details at this adapter boundary and avoid exposing the
 * authorization code to unrelated hosts.
 */

export interface ObsidianOAuthRequest {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  throw?: boolean;
}
export interface ObsidianOAuthResponse {
  status: number;
  text: string;
}

export type ObsidianOAuthRequester =
  (request: ObsidianOAuthRequest) => Promise<ObsidianOAuthResponse>;

const ORIGIN = "https://auth.openai.com";
const TOKEN_PATH = "/api/accounts/oauth/token";
const JWKS_PATH = "/.well-known/jwks.json";
const MAX_RESPONSE_CHARS = 1024 * 1024;

/** Adapt requestUrl's response to the narrow Fetch contract used by OAuth. */
export function createObsidianOAuthFetch(requestUrl: ObsidianOAuthRequester): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input
      : input instanceof URL ? input.toString() : input.url;
    const target = new URL(url);
    const method = (init?.method || "GET").toUpperCase();

    // Fail closed before creating an outbound request that may contain secrets.
    if (target.origin !== ORIGIN || target.username || target.password ||
        target.search || target.hash ||
        !((method === "POST" && target.pathname === TOKEN_PATH) ||
          (method === "GET" && target.pathname === JWKS_PATH))) {
      throw new Error("Unsupported ChatGPT OAuth request target.");
    }

    const signal = init?.signal;
    if (signal?.aborted) throw new DOMException("OAuth request cancelled.", "AbortError");

    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => { headers[name] = value; });
    }
    // OAuth sends form text over HTTPS; no implicit body coercion from buffers.
    if (init?.body && typeof init.body !== "string") {
      throw new Error("Unsupported ChatGPT OAuth request body.");
    }

    let abort: (() => void) | undefined;
    const abortPromise = signal && new Promise<never>((_resolve, reject) => {
      abort = () => reject(new DOMException("OAuth request cancelled.", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });

    try {
      const pending = requestUrl({
        url, method, headers, ...(init?.body ? { body: init.body as string } : {}),
        // Preserve 4xx/5xx response bodies/status for sanitized OAuth diagnosis.
        throw: false,
      });
      const response = abortPromise
        ? await Promise.race([pending, abortPromise]) : await pending;
      if (typeof response.text !== "string" ||
          response.text.length > MAX_RESPONSE_CHARS) {
        throw new Error("Invalid ChatGPT OAuth response size.");
      }
      // Do not forward Content-Length / Content-Encoding into Response, because
      // requestUrl has already decoded the response body.
      return new Response(response.text, { status: response.status });
    } finally {
      if (abort && signal) signal.removeEventListener("abort", abort);
    }
  };
}
