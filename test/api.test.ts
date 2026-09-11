import { expect, it } from "vitest";
import { evictDurableObject } from "cloudflare:test";
import {
  address,
  input,
  post,
  runInDurableObject,
  SELF,
  stub,
  setState,
} from "./helpers";
import { readInput, validateInput } from "../src/server/http";
import { decideAcceptance } from "../src/server/room";
import type { Ping } from "../src/protocol";

const other = "198.51.100.7";

it("accepts zero coordinates, trims text, and returns a fixed lifetime with public CORS", async () => {
  const response = await post({
    ...input,
    title: "  Hello  ",
    imageUrl: "https://example.com/ping.png",
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  const ping = await response.json<Ping>();
  expect(ping).toMatchObject({
    ...input,
    imageUrl: "https://example.com/ping.png",
  });
  expect(ping.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(ping.expiresAt - ping.createdAt).toBe(60_000);
});

it("accepts exactly one request from a simultaneous burst of distinct sources", async () => {
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, i) => post(input, `203.0.113.${i + 1}`)),
  );
  expect(responses.filter((response) => response.status === 201)).toHaveLength(
    1,
  );
  expect(responses.filter((response) => response.status === 429)).toHaveLength(
    19,
  );
  const rejected = responses.find((response) => response.status === 429)!;
  expect(rejected.headers.get("Retry-After")).toBe("1");
  expect(rejected.headers.get("Access-Control-Expose-Headers")).toBe(
    "Retry-After",
  );
});

it("rejects at 999 milliseconds and accepts at exactly 1000 without a fixed-window burst", () => {
  const time = Date.parse("2026-09-10T12:00:00.999Z");
  const state = {
    lastAcceptedAt: time,
    day: "2026-09-10",
    count: 1,
    pings: [],
    sources: {},
  };
  expect(decideAcceptance(state, time + 999, 10_000, "a", "ui")).toMatchObject({
    code: "rate_limited",
    retryAfterMs: 1,
  });
  expect(decideAcceptance(state, time + 1000, 10_000, "a", "ui")).toEqual({
    day: "2026-09-10",
    count: 2,
  });
});

it("accepts one API ping every minute from each source", async () => {
  expect((await post()).status).toBe(201);
  const repeat = await post();
  expect(repeat.status).toBe(429);
  expect(repeat.headers.get("Retry-After")).toBe("60");
  expect(await repeat.json()).toMatchObject({
    error: { code: "source_limited", retryAfterMs: expect.any(Number) },
  });
  await setState({
    lastAcceptedAt: Date.now() - 6000,
    lastApiAcceptedAt: Date.now() - 6000,
  });
  expect(
    (await post({ ...input, title: "Another signal" }, other)).status,
  ).toBe(201);
  await setState({
    lastAcceptedAt: Date.now() - 6000,
    lastApiAcceptedAt: Date.now() - 6000,
  });
  expect((await post()).status).toBe(429);
});

it("rejects a source at 9,999 milliseconds and accepts it at exactly 10,000", () => {
  const time = Date.parse("2026-09-10T12:00:00Z");
  const state = {
    lastAcceptedAt: time,
    day: "2026-09-10",
    count: 1,
    pings: [],
    sources: { a: time },
  };
  expect(
    decideAcceptance(state, time + 9_999, 10_000, "a", "ui"),
  ).toMatchObject({
    code: "source_limited",
    retryAfterMs: 1,
  });
  expect(decideAcceptance(state, time + 10_000, 10_000, "a", "ui")).toEqual({
    day: "2026-09-10",
    count: 2,
  });
  expect(decideAcceptance(state, time + 1000, 10_000, "b", "ui")).toEqual({
    day: "2026-09-10",
    count: 2,
  });
});

it("keeps the API source limit after eviction and forgets sources after one minute", async () => {
  await post();
  await evictDurableObject(stub());
  await setState({
    lastAcceptedAt: Date.now() - 6000,
    lastApiAcceptedAt: Date.now() - 6000,
  });
  expect(await (await post()).json()).toMatchObject({
    error: { code: "source_limited" },
  });
  await runInDurableObject(stub(), async (_instance, state) => {
    const stored = await state.storage.get<{ sources: Record<string, number> }>(
      "state",
    );
    const [key] = Object.keys(stored!.sources);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain(address);
    stored!.sources = {
      [key]: Date.now() - 60_000,
      stale: Date.now() - 61_000,
    };
    await state.storage.put("state", stored);
  });
  await evictDurableObject(stub());
  expect((await post({ ...input, title: "Fresh content" })).status).toBe(201);
  await runInDurableObject(stub(), async (_instance, state) => {
    const stored = await state.storage.get<{ sources: Record<string, number> }>(
      "state",
    );
    expect(Object.keys(stored!.sources)).toHaveLength(1);
  });
});

it("shares one source bucket among requests without a client address", async () => {
  expect((await post(input, "")).status).toBe(201);
  await setState({
    lastAcceptedAt: Date.now() - 6000,
    lastApiAcceptedAt: Date.now() - 6000,
  });
  expect(await (await post(input, "")).json()).toMatchObject({
    error: { code: "source_limited" },
  });
  expect(
    (await post({ ...input, title: "Another signal" }, other)).status,
  ).toBe(201);
});

it("keeps the one-second limit and daily count after eviction", async () => {
  await post();
  await evictDurableObject(stub());
  expect(await (await post(input, other)).json()).toMatchObject({
    error: { code: "rate_limited" },
  });
  await setState({
    lastAcceptedAt: Date.now() - 6000,
    lastApiAcceptedAt: Date.now() - 6000,
    day: new Date().toISOString().slice(0, 10),
    count: 10_000,
  });
  await evictDurableObject(stub());
  const limited = await post(input, other);
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({
    error: { code: "daily_limit" },
  });
  await setState({ day: "2000-01-01" });
  expect(
    (await post({ ...input, title: "Another signal" }, other)).status,
  ).toBe(201);
});

it("resets the daily count at midnight while retaining the one-second spacing", () => {
  const midnight = Date.parse("2026-09-11T00:00:00Z");
  const state = {
    lastAcceptedAt: midnight - 500,
    day: "2026-09-10",
    count: 10_000,
    pings: [],
    sources: {},
  };
  expect(decideAcceptance(state, midnight, 10_000, "a", "ui")).toMatchObject({
    code: "rate_limited",
    retryAfterMs: 500,
  });
  expect(decideAcceptance(state, midnight + 500, 10_000, "a", "ui")).toEqual({
    day: "2026-09-11",
    count: 1,
  });
});

it.each([
  null,
  [],
  {},
  { ...input, latitude: "0" },
  { ...input, latitude: 90.01 },
  { ...input, longitude: -180.01 },
  { ...input, title: " " },
  { ...input, title: "x".repeat(81) },
  { ...input, message: "x".repeat(161) },
  { ...input, imageUrl: "http://example.com/a.png" },
  { ...input, imageUrl: "javascript:alert(1)" },
  { ...input, imageUrl: "data:image/png;base64,a" },
  { ...input, imageUrl: "https://user:password@example.com/a.png" },
  { ...input, imageUrl: "" },
  { ...input, imageUrl: "https://example.com/" + "a".repeat(2048) },
])(
  "rejects invalid input without consuming the acceptance slot: %j",
  async (payload) => {
    const bad = await post(payload);
    expect(bad.status).toBe(400);
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await post()).status).toBe(201);
  },
);

it("accepts coordinate boundaries and counts Unicode code points", () => {
  expect(
    validateInput({
      ...input,
      latitude: -90,
      longitude: 180,
      title: "🌍".repeat(80),
    }).title,
  ).toBe("🌍".repeat(80));
  expect(() => validateInput({ ...input, latitude: Infinity })).toThrow();
  expect(() => validateInput({ ...input, longitude: NaN })).toThrow();
});

it("checks content type, malformed JSON, and unknown routes", async () => {
  const fetch = (path: string, body: string, headers = {}) =>
    SELF.fetch(`https://handymap.test${path}`, {
      method: "POST",
      body,
      headers,
    });
  expect((await fetch("/api/pings", "{}")).status).toBe(415);
  expect(
    (await fetch("/api/pings", "{", { "Content-Type": "application/json" }))
      .status,
  ).toBe(400);
  expect((await fetch("/api/unknown", "{}")).status).toBe(404);
  expect((await fetch("/", "{}")).status).toBe(405);
  expect((await SELF.fetch("https://handymap.test/api/pings")).status).toBe(
    405,
  );
  expect((await SELF.fetch("https://handymap.test/ws")).status).toBe(426);
});

it("supports browser preflight without consuming a slot", async () => {
  const response = await SELF.fetch("https://handymap.test/api/pings", {
    method: "OPTIONS",
    headers: {
      Origin: "https://another.test",
      "Access-Control-Request-Method": "POST",
    },
  });
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
    "Content-Type",
  );
  expect((await post()).status).toBe(201);
});

it("limits actual UTF-8 bytes, including streamed requests without Content-Length", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(" ".repeat(4090)));
      controller.enqueue(new TextEncoder().encode("🌍🌍"));
      controller.close();
    },
  });
  const request = new Request("https://handymap.test/api/pings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
  });
  expect(request.headers.has("Content-Length")).toBe(false);
  await expect(readInput(request)).rejects.toMatchObject({ status: 413 });
  const response = await SELF.fetch("https://handymap.test/api/pings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: " ".repeat(4097),
  });
  expect(response.status).toBe(413);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
});

it("returns a CORS error when storage is unavailable", async () => {
  const { default: worker } = await import("../src/server/index");
  const { env } = await import("./helpers");
  const response = await worker.fetch(
    new Request("https://handymap.test/api/pings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
    {
      ...env,
      MAP: {
        getByName() {
          throw new Error("Storage is unavailable.");
        },
      } as unknown as typeof env.MAP,
    },
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(await response.json()).toMatchObject({
    error: { code: "service_unavailable" },
  });
});

it("rejects invalid UTF-8 rather than silently replacing it", async () => {
  const request = new Request("https://handymap.test/api/pings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new Uint8Array([0xff]),
  });
  await expect(readInput(request)).rejects.toMatchObject({
    status: 400,
    code: "invalid_json",
  });
});

const browserHeaders = {
  Origin: "https://handymap.test",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
};

it.each([
  [browserHeaders, 201],
  [{}, 403],
  [{ ...browserHeaders, Origin: "https://another.test" }, 403],
  [{ ...browserHeaders, "Sec-Fetch-Site": "cross-site" }, 403],
  [{ ...browserHeaders, "Sec-Fetch-Mode": "" }, 403],
  [{ Origin: "https://handymap.test" }, 403],
] as const)(
  "gates the browser route with same-origin fetch metadata: %j",
  async (headers, status) => {
    const response = await post(input, address, headers, "/api/browser-pings");
    expect(response.status).toBe(status);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    if (status === 403) expect((await post()).status).toBe(201);
  },
);

it("keeps API limits when a caller supplies browser headers and a channel field", async () => {
  await post();
  await setState({ lastAcceptedAt: Date.now() - 2000 });
  const response = await post(
    { ...input, title: "A new moment", channel: "ui" },
    address,
    browserHeaders,
  );
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({
    error: { code: "source_limited", retryAfterMs: expect.any(Number) },
  });
  expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(50);
});

it("keeps API spacing separate from browser use and shares the daily cap", async () => {
  await post();
  await setState({ lastAcceptedAt: Date.now() - 2000 });
  const api = await post({ ...input, title: "API update" }, other);
  expect(await api.json()).toMatchObject({
    error: { code: "api_rate_limited" },
  });
  expect(
    (
      await post(
        { ...input, title: "Browser update" },
        other,
        browserHeaders,
        "/api/browser-pings",
      )
    ).status,
  ).toBe(201);
  await setState({ lastAcceptedAt: Date.now() - 2000, count: 10_000 });
  expect(
    await (
      await post(
        { ...input, title: "Over the cap" },
        "192.0.2.4",
        browserHeaders,
        "/api/browser-pings",
      )
    ).json(),
  ).toMatchObject({ error: { code: "daily_limit" } });
});

it("enforces exact API boundaries across midnight", () => {
  const time = Date.parse("2026-09-10T23:59:59Z");
  const state = {
    lastAcceptedAt: time,
    lastApiAcceptedAt: time,
    day: "2026-09-10",
    count: 10_000,
    pings: [],
    sources: { a: time },
  };
  expect(
    decideAcceptance(state, time + 4999, 10_000, "b", "api"),
  ).toMatchObject({ code: "api_rate_limited", retryAfterMs: 1 });
  expect(decideAcceptance(state, time + 5000, 10_000, "b", "api")).toEqual({
    day: "2026-09-11",
    count: 1,
  });
  expect(
    decideAcceptance(state, time + 59_999, 10_000, "a", "api"),
  ).toMatchObject({ code: "source_limited", retryAfterMs: 1 });
  expect(decideAcceptance(state, time + 60_000, 10_000, "a", "api")).toEqual({
    day: "2026-09-11",
    count: 1,
  });
  expect(decideAcceptance(state, time + 10_000, 10_000, "a", "ui")).toEqual({
    day: "2026-09-11",
    count: 1,
  });
});

it("blocks normalized duplicate content across sources and channels after eviction", async () => {
  expect((await post()).status).toBe(201);
  await setState({
    lastAcceptedAt: Date.now() - 6000,
    lastApiAcceptedAt: Date.now() - 6000,
  });
  await evictDurableObject(stub());
  const duplicate = {
    ...input,
    title: "  ＨＥＬＬＯ  ",
    message: "A   SMALL\nsignal.",
    latitude: 45,
    longitude: 90,
    imageUrl: "https://example.com/new.png",
  };
  for (const headers of [{}, browserHeaders]) {
    const response = await post(
      duplicate,
      other,
      headers,
      headers === browserHeaders ? "/api/browser-pings" : "/api/pings",
    );
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(290);
    expect(await response.json()).toMatchObject({
      error: { code: "duplicate_content" },
    });
  }
  await runInDurableObject(stub(), async (_instance, ctx) => {
    const state = (await ctx.storage.get<{
      lastAcceptedAt: number;
      lastApiAcceptedAt: number;
      count: number;
      sources: Record<string, number>;
      fingerprints: Record<string, number>;
    }>("state"))!;
    expect(state.count).toBe(1);
    expect(Object.keys(state.sources)).toHaveLength(1);
    expect(Object.keys(state.fingerprints)).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
  });
  expect(
    (await post({ ...input, message: "A different moment." }, other)).status,
  ).toBe(201);
});

it("expires duplicate limits at exactly five minutes without resetting them on rejection", () => {
  const time = Date.parse("2026-09-10T12:00:00Z");
  const state = {
    lastAcceptedAt: time,
    day: "2026-09-10",
    count: 1,
    pings: [],
    sources: {},
    fingerprints: { content: time },
  };
  expect(
    decideAcceptance(state, time + 299_999, 10_000, "a", "api", "content"),
  ).toMatchObject({ code: "duplicate_content", retryAfterMs: 1 });
  expect(
    decideAcceptance(state, time + 300_000, 10_000, "a", "api", "content"),
  ).toEqual({ day: "2026-09-10", count: 2 });
});
