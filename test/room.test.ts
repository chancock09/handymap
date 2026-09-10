import { expect, it } from "vitest";
import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import {
  connect,
  input,
  pingAt,
  post,
  runInDurableObject,
  setState,
  stub,
} from "./helpers";
import type { Ping } from "../src/protocol";

it("broadcasts the same accepted ping to two viewers once and restores it for late viewers", async () => {
  const a = await connect(),
    b = await connect();
  await a.next("snapshot");
  await b.next("snapshot");
  const response = await post();
  const ping = await response.json<Ping>();
  expect(await a.next("ping")).toMatchObject({ ping });
  expect(await b.next("ping")).toMatchObject({ ping });
  expect((await post()).status).toBe(429);
  await evictDurableObject(stub());
  const late = await connect();
  expect(await late.next("snapshot")).toMatchObject({ pings: [ping] });
  expect(a.messages).toHaveLength(0);
  expect(b.messages).toHaveLength(0);
});

it("filters expired pings from snapshots and removes payloads with an alarm", async () => {
  const expired = pingAt(Date.now() - 63_000),
    active = pingAt(Date.now() - 10_000);
  await setState({
    pings: [expired, active],
    count: 7,
    day: new Date().toISOString().slice(0, 10),
    lastAcceptedAt: active.createdAt,
  });
  const viewer = await connect();
  expect(await viewer.next("snapshot")).toMatchObject({ pings: [active] });
  await runInDurableObject(stub(), async (_instance, state) => {
    await state.storage.setAlarm(Date.now());
  });
  await runDurableObjectAlarm(stub());
  await runInDurableObject(stub(), async (_instance, state) => {
    expect(await state.storage.get("state")).toMatchObject({
      count: 7,
      pings: [active],
      lastAcceptedAt: active.createdAt,
    });
    expect(await state.storage.getAlarm()).toBe(active.expiresAt);
  });
  await setState({ pings: [expired] });
  await runDurableObjectAlarm(stub());
  await runInDurableObject(stub(), async (_instance, state) => {
    expect(await state.storage.get("state")).toMatchObject({
      pings: [],
      count: 7,
    });
    expect(await state.storage.getAlarm()).toBeNull();
  });
});

it("enforces 100 viewers across hibernation and frees a slot after disconnect", async () => {
  const viewers = [];
  for (let i = 0; i < 100; i++) {
    const viewer = await connect();
    await viewer.next("snapshot");
    viewers.push(viewer);
  }
  await evictDurableObject(stub());
  const extra = await connect();
  expect(await extra.closed()).toBe(1013);
  viewers[0].ws.close(1000);
  await viewers[0].closed();
  const replacement = await connect();
  expect(await replacement.next("snapshot")).toMatchObject({ pings: [] });
});

it("answers heartbeats and rejects ping submissions over WebSocket", async () => {
  const viewer = await connect();
  await viewer.next("snapshot");
  await evictDurableObject(stub());
  viewer.ws.send("heartbeat");
  expect(await viewer.alive()).toBe(true);
  viewer.ws.send(JSON.stringify(input));
  expect(await viewer.closed()).toBe(1008);
  expect((await post()).status).toBe(201);
});

it("closes public sessions on restart and preserves private sessions", async () => {
  const legacy = await connect();
  await legacy.next("snapshot");
  await runInDurableObject(stub(), async (_instance, state) => {
    for (const socket of state.getWebSockets())
      socket.serializeAttachment(null);
  });
  const current = await connect();
  await current.next("snapshot");
  await evictDurableObject(stub());
  const response = await post();
  expect(response.status).toBe(201);
  expect(await legacy.closed()).toBe(1008);
  expect(legacy.messages).toHaveLength(0);
  expect(await current.next("ping")).toMatchObject({ ping: input });
});
