import { DurableObject } from "cloudflare:workers";
import {
  API_INTERVAL_MS,
  API_SOURCE_INTERVAL_MS,
  DUPLICATE_INTERVAL_MS,
  INTERVAL_MS,
  LIFETIME_MS,
  SOURCE_INTERVAL_MS,
  type Ping,
  type PingInput,
  type MapEvent,
} from "../protocol";
import { error, validateInput } from "./http";
import type { Env } from "./index";

const ACCESS_GENERATION = "public-v2";

interface MapState {
  lastAcceptedAt: number | null;
  day: string;
  count: number;
  pings: Ping[];
  sources: Record<string, number>;
  lastApiAcceptedAt?: number | null;
  fingerprints?: Record<string, number>;
}

export interface Submission {
  source: string;
  channel: "ui" | "api";
  input: PingInput;
}

const EMPTY_STATE: MapState = {
  lastAcceptedAt: null,
  day: "",
  count: 0,
  pings: [],
  sources: {},
};

function activeEntries(
  sources: Record<string, number> | undefined,
  now: number,
  interval: number,
) {
  return Object.fromEntries(
    Object.entries(sources ?? {}).filter(
      ([, acceptedAt]) => now - acceptedAt < interval,
    ),
  );
}

export function decideAcceptance(
  state: MapState,
  now: number,
  dailyLimit: number,
  source: string,
  channel: Submission["channel"],
  fingerprint?: string,
) {
  const day = new Date(now).toISOString().slice(0, 10);
  const count = state.day === day ? state.count : 0;
  const sourceInterval =
    channel === "api" ? API_SOURCE_INTERVAL_MS : SOURCE_INTERVAL_MS;
  const sourceAcceptedAt = state.sources?.[source];
  if (
    sourceAcceptedAt !== undefined &&
    now - sourceAcceptedAt < sourceInterval
  ) {
    return {
      code: "source_limited",
      message: `Each source can add one ${channel === "api" ? "API " : ""}ping every ${sourceInterval / 1000} seconds. Try again later.`,
      retryAfterMs: sourceInterval - (now - sourceAcceptedAt),
    };
  }
  if (
    state.lastAcceptedAt !== null &&
    now - state.lastAcceptedAt < INTERVAL_MS
  ) {
    return {
      code: "rate_limited",
      message: "The map accepts one ping per second. Try again later.",
      retryAfterMs: INTERVAL_MS - (now - state.lastAcceptedAt),
    };
  }
  if (
    channel === "api" &&
    state.lastApiAcceptedAt != null &&
    now - state.lastApiAcceptedAt < API_INTERVAL_MS
  ) {
    return {
      code: "api_rate_limited",
      message: "The API accepts one ping every 5 seconds. Try again later.",
      retryAfterMs: API_INTERVAL_MS - (now - state.lastApiAcceptedAt),
    };
  }
  if (count >= dailyLimit) {
    const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return {
      code: "daily_limit",
      message: "The daily ping limit is reached. Try again after midnight UTC.",
      retryAfterMs: midnight - now,
    };
  }
  const duplicateAt = fingerprint
    ? state.fingerprints?.[fingerprint]
    : undefined;
  if (duplicateAt !== undefined && now - duplicateAt < DUPLICATE_INTERVAL_MS) {
    return {
      code: "duplicate_content",
      message:
        "This title and message were shared recently. Wait 5 minutes before you repeat them.",
      retryAfterMs: DUPLICATE_INTERVAL_MS - (now - duplicateAt),
    };
  }
  return { day, count: count + 1 };
}

async function fingerprintOf(input: PingInput) {
  const normalize = (value: string) =>
    value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([normalize(input.title), normalize(input.message)]),
    ),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function nextExpiry(pings: Ping[], fingerprints: Record<string, number>) {
  return Math.min(
    ...pings.map((ping) => ping.expiresAt),
    ...Object.values(fingerprints).map((time) => time + DUPLICATE_INTERVAL_MS),
  );
}

function limit(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class MapRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Sessions from an earlier release reconnect so they pass the current gate.
    for (const socket of ctx.getWebSockets()) {
      if (socket.deserializeAttachment() !== ACCESS_GENERATION)
        socket.close(1008, "access_changed");
    }
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("heartbeat", "alive"),
    );
  }

  private async state() {
    return (await this.ctx.storage.get<MapState>("state")) ?? EMPTY_STATE;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const { source, input, channel } = (await request.json()) as Submission;
      if (typeof source !== "string" || !source)
        return error(400, "invalid_payload", "A source is required.");
      return this.accept(
        source,
        validateInput(input),
        channel === "ui" ? "ui" : "api",
      );
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return error(426, "upgrade_required", "Use a WebSocket connection.");
    return this.ctx.blockConcurrencyWhile(async () => {
      const [client, server] = Object.values(new WebSocketPair());
      if (
        this.ctx
          .getWebSockets()
          .filter((socket) => socket.readyState === WebSocket.OPEN).length >=
        limit(this.env.MAX_VIEWERS, 100)
      ) {
        server.accept();
        server.close(1013, "viewer_capacity");
        return new Response(null, { status: 101, webSocket: client });
      }
      const state = await this.state();
      server.serializeAttachment(ACCESS_GENERATION);
      const viewer = new URL(request.url).searchParams.get("viewer") ?? "";
      this.ctx.acceptWebSocket(server, [
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          viewer,
        )
          ? viewer.toLowerCase()
          : crypto.randomUUID(),
      ]);
      const now = Date.now();
      server.send(
        JSON.stringify({
          type: "snapshot",
          pings: state.pings.filter((ping) => ping.expiresAt > now),
          serverTime: now,
          viewers: this.viewerCount(),
        } satisfies MapEvent),
      );
      this.broadcastPresence(server);
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  private liveSockets(exclude?: WebSocket) {
    return this.ctx
      .getWebSockets()
      .filter(
        (socket) => socket !== exclude && socket.readyState === WebSocket.OPEN,
      );
  }

  private viewerCount(exclude?: WebSocket) {
    return new Set(
      this.liveSockets(exclude).map(
        (socket) => this.ctx.getTags(socket)[0] ?? socket,
      ),
    ).size;
  }

  private broadcastPresence(skip?: WebSocket, disconnected?: WebSocket) {
    const message = JSON.stringify({
      type: "presence",
      viewers: this.viewerCount(disconnected),
      serverTime: Date.now(),
    } satisfies MapEvent);
    for (const socket of this.liveSockets(skip)) {
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "connection_failed");
      }
    }
  }

  private async accept(
    source: string,
    input: PingInput,
    channel: Submission["channel"],
  ): Promise<Response> {
    const fingerprint = await fingerprintOf(input);
    return this.ctx.blockConcurrencyWhile(async () => {
      const outcome = await this.ctx.storage.transaction(
        async (transaction) => {
          const state =
            (await transaction.get<MapState>("state")) ?? EMPTY_STATE;
          const now = Date.now();
          const decision = decideAcceptance(
            state,
            now,
            limit(this.env.MAX_PINGS_PER_DAY, 10_000),
            source,
            channel,
            fingerprint,
          );
          if ("code" in decision) return { rejection: decision };
          const ping: Ping = {
            ...input,
            id: crypto.randomUUID(),
            createdAt: now,
            expiresAt: now + LIFETIME_MS,
          };
          const pings = [
            ...state.pings.filter((item) => item.expiresAt > now),
            ping,
          ];
          const fingerprints = {
            ...activeEntries(state.fingerprints, now, DUPLICATE_INTERVAL_MS),
            [fingerprint]: now,
          };
          await transaction.put("state", {
            lastAcceptedAt: now,
            day: decision.day,
            count: decision.count,
            pings,
            sources: {
              ...activeEntries(state.sources, now, API_SOURCE_INTERVAL_MS),
              [source]: now,
            },
            lastApiAcceptedAt:
              channel === "api" ? now : (state.lastApiAcceptedAt ?? null),
            fingerprints,
          } satisfies MapState);
          await transaction.setAlarm(nextExpiry(pings, fingerprints));
          return { ping };
        },
      );
      if (outcome.rejection) {
        const { code, message, retryAfterMs } = outcome.rejection;
        return error(429, code!, message!, retryAfterMs);
      }
      const ping = outcome.ping!;
      const message = JSON.stringify({
        type: "ping",
        ping,
        serverTime: Date.now(),
      } satisfies MapEvent);
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message);
        } catch {
          socket.close(1011, "connection_failed");
        }
      }
      return Response.json(ping, { status: 201 });
    });
  }

  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.transaction(async (transaction) => {
        const state = await transaction.get<MapState>("state");
        if (!state) return;
        const now = Date.now();
        state.pings = state.pings.filter((ping) => ping.expiresAt > now);
        state.sources = activeEntries(
          state.sources,
          now,
          API_SOURCE_INTERVAL_MS,
        );
        state.fingerprints = activeEntries(
          state.fingerprints,
          now,
          DUPLICATE_INTERVAL_MS,
        );
        await transaction.put("state", state);
        if (state.pings.length || Object.keys(state.fingerprints).length)
          await transaction.setAlarm(
            nextExpiry(state.pings, state.fingerprints),
          );
      });
    });
  }

  webSocketMessage(socket: WebSocket) {
    socket.close(1008, "Use POST /api/pings to submit a ping.");
    this.broadcastPresence(socket, socket);
  }

  webSocketClose(socket: WebSocket) {
    socket.close(1000);
    this.broadcastPresence(socket, socket);
  }

  webSocketError(socket: WebSocket) {
    socket.close(1011, "connection_failed");
    this.broadcastPresence(socket, socket);
  }
}
