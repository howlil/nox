import type { ObsidianOAuthRequester } from "./ObsidianOAuthTransport";

/**
 * Adapter for Obsidian's CORS-free requestUrl. The method intentionally
 * buffers inference SSE: requestUrl does not offer progressive response chunks.
 * The existing ChatGptAdapter validates the terminal response.completed event
 * after parsing this body. Do not claim true token streaming in this mode.
 */
const ORIGIN = "https://api.openai.com";
const MODELS = "/v1/models";
const RESPONSES = "/v1/responses";
const MAX_CATALOG_CHARS = 2 * 1024 * 1024;
const MAX_RESPONSE_CHARS = 16 * 1024 * 1024;

export function createObsidianInferenceFetch(requestUrl: ObsidianOAuthRequester): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input
      : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();

    // A bearer access token must only ever leave the application for the
    // two documented ChatGPT-plan inference endpoints.
    if (parsed.origin !== ORIGIN || parsed.username || parsed.password ||
        parsed.search || parsed.hash || !(
          (method === "GET" && parsed.pathname === MODELS) ||
          (method === "POST" && parsed.pathname === RESPONSES)
        )) {
      throw new Error("Unsupported ChatGPT inference endpoint.");
    }

    if (init?.signal?.aborted) throw new DOMException("Inference cancelled.", "AbortError");
    if (init?.body !== undefined && typeof init.body !== "string") {
      throw new Error("Unsupported ChatGPT inference body.");
    }
    const headers: Record<string, string> = {};
    if (init?.headers) new Headers(init.headers).forEach((v, k) => { headers[k] = v; });

    // We cannot cancel requestUrl's underlying socket. Abort only stops
    // waiting locally; never automatically replay an inference request.
    const signal = init?.signal;
    let abort: (() => void) | undefined;
    const cancelled = signal && new Promise<never>((_resolve, reject) => {
      abort = () => reject(new DOMException("Inference cancelled.", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });

    try {
      const pending = requestUrl({
        url, method, headers, ...(init?.body === undefined ? {} : { body: init.body as string }),
        throw: false,
      });
      const res = cancelled ? await Promise.race([pending, cancelled]) : await pending;
      const max = parsed.pathname === MODELS ? MAX_CATALOG_CHARS : MAX_RESPONSE_CHARS;
      if (typeof res.text !== "string" || res.text.length > max) {
        throw new Error("ChatGPT response exceeded the supported size limit.");
      }
      if (res.status < 200 || res.status > 599) {
        throw new Error("Invalid ChatGPT HTTP response status.");
      }
      return new Response(res.text, { status: res.status });
    } finally {
      if (signal && abort) signal.removeEventListener("abort", abort);
    }
  };
}
