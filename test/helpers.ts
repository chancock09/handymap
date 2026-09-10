import { env, SELF, runInDurableObject, reset } from "cloudflare:test";
import { afterEach, beforeEach, expect } from "vitest";
import type { MapEvent, Ping } from "../src/protocol";
export { env, SELF, runInDurableObject };
export const input = {
  latitude: 0,
  longitude: 0,
  title: "Hello",
  message: "A small signal.",
};
export const stub = () => env.MAP.getByName("world");
const clients: WebSocket[] = [];
beforeEach(async () => {
  await reset();
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await reset();
});
export async function post(payload: unknown = input) {
  const response = await SELF.fetch("https://handymap.test/api/pings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://another.test",
    },
    body: JSON.stringify(payload),
  });
  return new Response(await response.text(), response);
}
export async function setState(update: Record<string, unknown>) {
  await runInDurableObject(stub(), async (_instance, state) => {
    const existing = (await state.storage.get<Record<string, unknown>>(
      "state",
    )) ?? { lastAcceptedAt: null, day: "", count: 0, pings: [] };
    await state.storage.put("state", { ...existing, ...update });
  });
}
export async function connect(viewer?: string) {
  const url = new URL("https://handymap.test/ws");
  if (viewer) url.searchParams.set("viewer", viewer);
  const response = await SELF.fetch(url, {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  clients.push(ws);
  const messages: (MapEvent | string)[] = [];
  const listeners = new Set<() => void>();
  let closeCode: number | undefined;
  ws.addEventListener("message", (event) => {
    messages.push(
      event.data === "alive" ? "alive" : JSON.parse(event.data as string),
    );
    for (const listener of listeners) listener();
  });
  ws.addEventListener("close", (event) => {
    closeCode = event.code;
    for (const listener of listeners) listener();
  });
  ws.accept();
  function wait<T>(find: () => T | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error("WebSocket timed out."));
      }, 4000);
      const check = () => {
        const result = find();
        if (result !== undefined) {
          clearTimeout(timer);
          listeners.delete(check);
          resolve(result);
        }
      };
      listeners.add(check);
      check();
    });
  }
  return {
    ws,
    messages,
    next(type: MapEvent["type"]) {
      return wait(() => {
        const index = messages.findIndex(
          (message) => typeof message !== "string" && message.type === type,
        );
        return index < 0
          ? undefined
          : (messages.splice(index, 1)[0] as MapEvent);
      });
    },
    alive() {
      return wait(() => (messages.includes("alive") ? true : undefined));
    },
    closed() {
      return wait(() => closeCode);
    },
  };
}
export function pingAt(createdAt: number): Ping {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt,
    expiresAt: createdAt + 60_000,
  };
}
