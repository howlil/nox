import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";

/**
 * Real incremental SSE over Node HTTPS in the Obsidian desktop process.
 * No renderer fetch, no credentials in URL, and no automatic POST replay.
 * Network/proxy incompatibility is surfaced, not silently retried.
 */
export function createNodeInferenceFetch(bufferedCatalogFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.origin !== "https://api.openai.com" || url.username || url.password ||
      url.search || url.hash ||
      !((method === "GET" && url.pathname === "/v1/models") ||
        (method === "POST" && url.pathname === "/v1/responses"))) {
      throw new Error("Unsupported ChatGPT inference endpoint.");
    }
    if (method === "GET") return bufferedCatalogFetch(input, init);
    if (init?.signal?.aborted) throw new DOMException("Inference cancelled.", "AbortError");
    if (typeof init?.body !== "string") throw new Error("Streaming inference requires a JSON request body.");

    const headers: Record<string, string> = {};
    if (init.headers) new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
    return new Promise<Response>((resolve, reject) => {
      let resolved = false;
      let responseStream: IncomingMessage | undefined;
      const fail = (error: Error) => {
        if (resolved) { responseStream?.destroy(error); return; }
        resolved = true;
        reject(error);
      };
      const req = httpsRequest(url, {
        method, headers,
        timeout: 65_000,
      }, response => {
        responseStream = response;
        const status = response.statusCode ?? 0;
        if (status < 200 || status > 599) {
          fail(new Error("Invalid ChatGPT HTTP response status."));
          return;
        }
        let bytes = 0, ended = false;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 16 * 1024 * 1024) {
                const error = new Error("Streaming response exceeded 16 MiB.");
                controller.error(error);
                response.destroy(error);
                return;
              }
              controller.enqueue(new Uint8Array(chunk));
              if (controller.desiredSize !== null && controller.desiredSize <= 0) response.pause();
            });
            response.on("end", () => {
              ended = true;
              controller.close();
            });
            response.on("error", error => {
              if (!ended) {
                ended = true;
                controller.error(error);
              }
            });
            response.on("close", () => {
              if (!ended) {
                ended = true;
                controller.error(new Error("Inference connection closed before terminal SSE."));
              }
            });
          },
          pull() { response.resume(); },
          cancel() { response.destroy(); },
        });
        resolved = true;
        resolve(new Response(body, {
          status,
          headers: { "content-type": response.headers["content-type"] ?? "text/event-stream" },
        }));
      });
      const onAbort = () => req.destroy(new DOMException("Inference cancelled.", "AbortError"));
      init.signal?.addEventListener("abort", onAbort, { once: true });
      if (init.signal?.aborted) onAbort();
      req.on("error", fail);
      req.on("timeout", () => req.destroy(new Error("ChatGPT inference timed out.")));
      req.on("close", () => init.signal?.removeEventListener("abort", onAbort));
      req.end(init.body);
    });
  };
}
