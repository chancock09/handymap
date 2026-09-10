import { expect, it } from "vitest";
import { evictDurableObject } from "cloudflare:test";
import { input, post, SELF, stub, setState } from "./helpers";
import { readInput, validateInput } from "../src/server/http";
import { decideAcceptance } from "../src/server/room";
import type { Ping } from "../src/protocol";

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
  expect(ping.expiresAt - ping.createdAt).toBe(62_000);
});

it("accepts exactly one request from a simultaneous burst", async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, () => post()));
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
  };
  expect(decideAcceptance(state, time + 999, 10_000)).toMatchObject({
    code: "rate_limited",
    retryAfterMs: 1,
  });
  expect(decideAcceptance(state, time + 1000, 10_000)).toEqual({
    day: "2026-09-10",
    count: 2,
  });
});

it("keeps the one-second limit and daily count after eviction", async () => {
  await post();
  await evictDurableObject(stub());
  expect((await post()).status).toBe(429);
  await setState({
    lastAcceptedAt: Date.now() - 2000,
    day: new Date().toISOString().slice(0, 10),
    count: 10_000,
  });
  await evictDurableObject(stub());
  const limited = await post();
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({
    error: { code: "daily_limit" },
  });
  await setState({ day: "2000-01-01" });
  expect((await post()).status).toBe(201);
});

it("resets the daily count at midnight while retaining the one-second spacing", () => {
  const midnight = Date.parse("2026-09-11T00:00:00Z");
  const state = {
    lastAcceptedAt: midnight - 500,
    day: "2026-09-10",
    count: 10_000,
    pings: [],
  };
  expect(decideAcceptance(state, midnight, 10_000)).toMatchObject({
    code: "rate_limited",
    retryAfterMs: 500,
  });
  expect(decideAcceptance(state, midnight + 500, 10_000)).toEqual({
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
