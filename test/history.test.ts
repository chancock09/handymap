import { expect, it } from "vitest";
import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import {
  SELF,
  stub,
  post,
  input,
  pingAt,
  setState,
  runInDurableObject,
  connect,
} from "./helpers";
import { HISTORY_LIMIT, type HistoryPage, type Ping } from "../src/protocol";
import { PingHistory } from "../src/server/history";

async function read(query = "") {
  const response = await SELF.fetch(
    `https://handymap.test/api/history${query}`,
  );
  expect(response.status).toBe(200);
  return response.json<HistoryPage>();
}
async function seed(pings: Ping[]) {
  await runInDurableObject(stub(), (_instance, ctx) => {
    const history = new PingHistory(ctx.storage.sql);
    ctx.storage.transactionSync(() => {
      for (const ping of pings) history.record(ping);
    });
  });
}

it("starts empty and records only accepted pings from both submission paths", async () => {
  expect(await read()).toMatchObject({ pings: [], total: 0, next: null });
  const first = await (await post()).json<Ping>();
  expect((await post()).status).toBe(429);
  expect((await post({})).status).toBe(400);
  await setState({ lastAcceptedAt: null, sources: {} });
  const second = await (
    await post(
      { ...input, title: "Browser" },
      "203.0.113.11",
      {
        Origin: "https://handymap.test",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
      },
      "/api/browser-pings",
    )
  ).json<Ping>();
  expect(await read()).toMatchObject({
    pings: [second, first],
    total: 2,
    next: null,
  });
});

it("retains history through expiry, alarms, and object eviction", async () => {
  const ping = await (await post()).json<Ping>();
  await setState({ pings: [{ ...ping, expiresAt: Date.now() - 1 }] });
  await runInDurableObject(stub(), async (_instance, ctx) => {
    await ctx.storage.setAlarm(Date.now());
  });
  await runDurableObjectAlarm(stub());
  await evictDurableObject(stub());
  const viewer = await connect();
  expect(await viewer.next("snapshot")).toMatchObject({ pings: [] });
  expect(await read()).toMatchObject({ pings: [ping], total: 1 });
});

it("keeps the newest 3,600 pings and removes old search entries", async () => {
  const pings = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => ({
    ...pingAt(index),
    title: index < 5 ? "Discarded" : `Retained ${index}`,
  }));
  await seed(pings);
  expect((await read()).total).toBe(HISTORY_LIMIT);
  expect((await read()).pings[0]).toEqual(pings.at(-1));
  expect((await read("?q=discarded")).total).toBe(0);
  await runInDurableObject(stub(), (_instance, ctx) => {
    expect(
      ctx.storage.sql
        .exec<{ oldest: number }>("SELECT min(seq) AS oldest FROM history")
        .one().oldest,
    ).toBe(6);
    ctx.storage.sql.exec(
      "INSERT INTO history_search(history_search, rank) VALUES ('integrity-check', 1)",
    );
  });
});

it("searches across fields with normalized Unicode, whitespace, and substrings", async () => {
  const target = {
    ...pingAt(1),
    title: "Ｈｅｌｌｏ from Kraków",
    message: "We\tSHIPPED\n it.",
  };
  await seed([target, { ...pingAt(2), title: "Hello elsewhere" }]);
  expect(
    (await read(`?q=${encodeURIComponent("  HELLO   ship krako\u0301w ")}`))
      .pings,
  ).toEqual([target]);
  expect((await read("?q=missing")).total).toBe(0);
  expect((await read("?q=hello%20absent")).total).toBe(0);
});

it("treats punctuation, FTS operators, and short terms literally", async () => {
  const target = {
    ...pingAt(1),
    title: 'a "quote" OR 100% _',
    message: "東京 😀 abc\0def",
  };
  await seed([target, { ...pingAt(2), title: "Elsewhere", message: "1000" }]);
  for (const q of [
    '"quote"',
    "OR",
    "100%",
    "_",
    "東京",
    "😀",
    "abc\0def",
    "a OR",
  ]) {
    expect((await read(`?q=${encodeURIComponent(q)}`)).pings).toEqual([target]);
  }
});

it("pages without duplicates when new pings arrive between requests", async () => {
  const pings = Array.from({ length: 55 }, (_, index) => pingAt(index));
  await seed(pings);
  const first = await read();
  expect(first.pings).toEqual(pings.slice(5).reverse());
  expect(first.next).not.toBeNull();
  await seed([pingAt(100)]);
  const second = await read(`?before=${first.next}`);
  expect(second).toMatchObject({
    pings: pings.slice(0, 5).reverse(),
    total: 56,
    next: null,
  });
  expect((await read("?limit=200")).pings).toHaveLength(56);
});

it("pages search results with the count independent of the cursor", async () => {
  await seed(
    Array.from({ length: 7 }, (_, index) => ({
      ...pingAt(index),
      title: index % 2 ? "Match" : "Other",
    })),
  );
  const first = await read("?q=match&limit=2");
  const second = await read(`?q=match&limit=2&before=${first.next}`);
  expect(first.total).toBe(3);
  expect(first.pings).toHaveLength(2);
  expect(second).toMatchObject({ total: 3, next: null });
  expect(second.pings).toHaveLength(1);
});

it("rejects invalid and duplicate query parameters", async () => {
  for (const query of [
    "limit=0",
    "limit=201",
    "limit=1.5",
    "limit=1e2",
    "limit=",
    "before=-1",
    "before=0",
    "before=9007199254740992",
    "before=no",
    "q=a&q=b",
    "limit=1&limit=2",
    "extra=1",
    `q=${"x".repeat(241)}`,
  ]) {
    const response = await SELF.fetch(
      `https://handymap.test/api/history?${query}`,
    );
    expect(response.status, query).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_query" },
    });
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, HEAD, OPTIONS",
    );
  }
});

it("supports public CORS, HEAD, and OPTIONS and rejects writes", async () => {
  for (const [method, status] of [
    ["GET", 200],
    ["HEAD", 200],
    ["OPTIONS", 204],
    ["POST", 405],
    ["DELETE", 405],
  ] as const) {
    const response = await SELF.fetch("https://handymap.test/api/history", {
      method,
      headers: { Origin: "https://other.test" },
    });
    expect(response.status).toBe(status);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, HEAD, OPTIONS",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    if (method === "HEAD" || method === "OPTIONS")
      expect(await response.text()).toBe("");
    if (status === 405)
      expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  }
  const invalid = await SELF.fetch(
    "https://handymap.test/api/history?limit=0",
    { method: "HEAD" },
  );
  expect(invalid.status).toBe(400);
  expect(await invalid.text()).toBe("");
});

it("rolls back the live state if the history insert fails", async () => {
  await runInDurableObject(stub(), (_instance, ctx) => {
    ctx.storage.sql.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
  });
  expect((await post()).status).toBe(503);
  await runInDurableObject(stub(), async (_instance, ctx) => {
    expect(await ctx.storage.get("state")).toBeUndefined();
    expect(await ctx.storage.getAlarm()).toBeNull();
    ctx.storage.sql.exec("DROP TRIGGER fail_history");
  });
  expect((await read()).total).toBe(0);
  expect((await post()).status).toBe(201);
});

it("searches 120 short terms without exceeding SQL parameter limits", async () => {
  const terms = Array.from({ length: 120 }, (_, index) =>
    String.fromCodePoint(0x4e00 + index),
  );
  const target = {
    ...pingAt(1),
    title: terms.slice(0, 40).join(" "),
    message: terms.slice(40).join(" "),
  };
  await seed([target]);
  expect(
    (await read(`?q=${encodeURIComponent(terms.join(" "))}`)).pings,
  ).toEqual([target]);
});
