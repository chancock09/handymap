import { cors, error, readInput, RequestError } from "./http";
import type { MapRoom, Submission } from "./room";
export { MapRoom } from "./room";

// Pings are keyed by a hash of the client address so the room never stores raw IPs.
async function sourceOf(request: Request) {
  const address = request.headers.get("CF-Connecting-IP") ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(address),
  );
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface Env {
  MAP: DurableObjectNamespace<MapRoom>;
  ASSETS: Fetcher;
  MAX_PINGS_PER_DAY: string;
  MAX_VIEWERS: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const isApi = path.startsWith("/api/");
    const isBrowser = path === "/api/browser-pings";
    const respond = (response: Response) => {
      if (!isBrowser) return cors(response);
      const result = new Response(response.body, response);
      result.headers.set("Cache-Control", "no-store");
      result.headers.set("X-Content-Type-Options", "nosniff");
      return result;
    };
    try {
      if (path === "/healthz")
        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "no-store" } },
        );
      if (path === "/api/pings" || isBrowser) {
        if (
          isBrowser &&
          (request.headers.get("Origin") !== new URL(request.url).origin ||
            request.headers.get("Sec-Fetch-Site") !== "same-origin" ||
            request.headers.get("Sec-Fetch-Mode") !== "cors")
        )
          return respond(
            error(
              403,
              "browser_required",
              "Use the form on this site, or POST /api/pings for API access.",
            ),
          );
        if (request.method === "OPTIONS")
          return respond(new Response(null, { status: 204 }));
        if (request.method !== "POST") {
          const response = error(
            405,
            "method_not_allowed",
            `Use POST ${path}.`,
          );
          response.headers.set("Allow", "POST, OPTIONS");
          return respond(response);
        }
        const submission: Submission = {
          source: await sourceOf(request),
          channel: isBrowser ? "ui" : "api",
          input: await readInput(request),
        };
        const response = await env.MAP.getByName("world").fetch(
          "https://map/pings",
          { method: "POST", body: JSON.stringify(submission) },
        );
        console.log(
          JSON.stringify({ event: "submission", status: response.status }),
        );
        return respond(response);
      }
      if (isApi)
        return cors(
          error(404, "not_found", "This API endpoint does not exist."),
        );
      if (path === "/ws") {
        if (
          request.method !== "GET" ||
          request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
        )
          return error(426, "upgrade_required", "Use a WebSocket connection.");
        return await env.MAP.getByName("world").fetch(request);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return error(
          405,
          "method_not_allowed",
          "Use POST /api/pings to submit a ping.",
        );
      return await env.ASSETS.fetch(request);
    } catch (cause) {
      const response =
        cause instanceof RequestError
          ? error(cause.status, cause.code, cause.message)
          : error(
              503,
              "service_unavailable",
              "Live pings are unavailable. Try again later.",
              60_000,
            );
      console.log(
        JSON.stringify({ event: "request_failed", status: response.status }),
      );
      return isApi ? respond(response) : response;
    }
  },
} satisfies ExportedHandler<Env>;
