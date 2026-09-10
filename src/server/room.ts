import { DurableObject } from "cloudflare:workers";
import {
  INTERVAL_MS,
  LIFETIME_MS,
  type Ping,
  type PingInput,
  type MapEvent,
} from "../protocol";
import { error, validateInput } from "./http";
import type { Env } from "./index";

const ACCESS_GENERATION = "private-v1";

interface MapState {
  lastAcceptedAt: number | null;
  day: string;
  count: number;
  pings: Ping[];
}

export function decideAcceptance(
  state: MapState,
  now: number,
  dailyLimit: number,
) {
  const day = new Date(now).toISOString().slice(0, 10);
  const count = state.day === day ? state.count : 0;
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
  if (count >= dailyLimit) {
    const midnight = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
    return {
      code: "daily_limit",
      message: "The daily ping limit is reached. Try again after midnight UTC.",
      retryAfterMs: midnight - now,
    };
  }
  return { day, count: count + 1 };
}

function limit(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class MapRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Sessions from the public release must reconnect through the Access gate.
    for (const socket of ctx.getWebSockets()) {
      if (socket.deserializeAttachment() !== ACCESS_GENERATION)
        socket.close(1008, "access_changed");
    }
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("heartbeat", "alive"),
    );
  }

  private async state() {
    return (
      (await this.ctx.storage.get<MapState>("state")) ?? {
        lastAcceptedAt: null,
        day: "",
        count: 0,
        pings: [],
      }
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST")
      return this.accept(validateInput(await request.json()));
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
      this.ctx.acceptWebSocket(server);
      const now = Date.now();
      server.send(
        JSON.stringify({
          type: "snapshot",
          pings: state.pings.filter((ping) => ping.expiresAt > now),
          serverTime: now,
        } satisfies MapEvent),
      );
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  private async accept(input: PingInput): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const outcome = await this.ctx.storage.transaction(
        async (transaction) => {
          const state = (await transaction.get<MapState>("state")) ?? {
            lastAcceptedAt: null,
            day: "",
            count: 0,
            pings: [],
          };
          const now = Date.now();
          const decision = decideAcceptance(
            state,
            now,
            limit(this.env.MAX_PINGS_PER_DAY, 10_000),
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
          await transaction.put("state", {
            lastAcceptedAt: now,
            day: decision.day,
            count: decision.count,
            pings,
          } satisfies MapState);
          await transaction.setAlarm(pings[0].expiresAt);
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
        state.pings = state.pings.filter((ping) => ping.expiresAt > Date.now());
        await transaction.put("state", state);
        if (state.pings.length)
          await transaction.setAlarm(state.pings[0].expiresAt);
      });
    });
  }

  webSocketMessage(socket: WebSocket) {
    socket.close(1008, "Use POST /api/pings to submit a ping.");
  }

  webSocketClose(socket: WebSocket) {
    socket.close(1000);
  }

  webSocketError(socket: WebSocket) {
    socket.close(1011, "connection_failed");
  }
}
