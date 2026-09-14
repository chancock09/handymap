import { expect, test, type Page } from "@playwright/test";
import type { HistoryPage, Ping } from "../../src/protocol";

function ping(index: number, extra: Partial<Ping> = {}): Ping {
  return {
    id: `history-${index}`,
    latitude: 35.68,
    longitude: 139.69,
    title: `Signal ${index}`,
    message: `Hello number ${index}.`,
    createdAt: Date.now() - 120_000,
    expiresAt: Date.now() - 60_000,
    ...extra,
  };
}
function result(
  pings: Ping[],
  total = pings.length,
  next: number | null = null,
): HistoryPage {
  return { pings, total, next, serverTime: Date.now() };
}
async function mock(page: Page, response: HistoryPage) {
  await page.route("**/api/history?*", (route) =>
    route.fulfill({ json: response }),
  );
}

test("loads shared history through the map link and keeps text inert", async ({
  page,
}) => {
  const title = "<img src=x onerror=alert(1)>";
  await mock(
    page,
    result([
      ping(2, { title, imageUrl: "https://example.com/image.png" }),
      ping(1),
    ]),
  );
  await page.goto("/");
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.locator("#history-list h3")).toHaveText([
    title,
    "Signal 1",
  ]);
  await expect(page.locator("#history-status")).toHaveText(
    "2 pings in the public history.",
  );
  await expect(page.locator("#history-list img")).toHaveCount(0);
  await expect(page.locator("#history-list a")).toHaveAttribute(
    "rel",
    "noreferrer noopener",
  );
  await expect(page.locator("#history-list a")).toHaveAttribute(
    "href",
    "https://example.com/image.png",
  );
  await page.reload();
  await expect(page.locator("#history-list li")).toHaveCount(2);
});

test("loads a shared search URL, debounces input, and handles empty results", async ({
  page,
}) => {
  const queries: string[] = [];
  await page.route("**/api/history?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    queries.push(q);
    return route.fulfill({
      json: result(
        q === "missing" ? [] : [ping(1, { title: "Hello from Kraków" })],
      ),
    });
  });
  await page.goto("/history?q=KRAK%C3%93W");
  await expect(page.locator("#history-search")).toHaveValue("KRAKÓW");
  await expect(page.locator("#history-list h3")).toHaveText([
    "Hello from Kraków",
  ]);
  await page.clock.install();
  await page.locator("#history-search").fill("miss");
  await page.locator("#history-search").fill("missing");
  await page.clock.fastForward(299);
  expect(queries).toEqual(["KRAKÓW"]);
  await page.clock.fastForward(1);
  await expect(page.locator("#history-status")).toHaveText(
    "No pings match “missing”.",
  );
  await expect(page).toHaveURL(/q=missing$/);
  await expect(page.locator("#history-list li")).toHaveCount(0);
  await page.locator("#history-search").fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.clock.fastForward(1);
  await expect(page.locator("#history-status")).toHaveText(
    "1 ping in the public history.",
  );
  await expect(page).toHaveURL(/\/history$/);
});

test("pages older matches and retries a failed page without duplicate rows", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/history?*", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("q")).toBe("Signal");
    if (!url.searchParams.has("before"))
      return route.fulfill({ json: result([ping(3), ping(2)], 3, 2) });
    expect(url.searchParams.get("before")).toBe("2");
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: {} });
    }
    return route.fulfill({ json: result([ping(1)], 3) });
  });
  await page.goto("/history?q=Signal");
  await page.getByRole("button", { name: "Show older pings" }).click();
  await expect(page.locator("#history-status")).toHaveText(
    "History is unavailable. Try again.",
  );
  await expect(page.locator("#history-list li")).toHaveCount(2);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#history-list h3")).toHaveText([
    "Signal 3",
    "Signal 2",
    "Signal 1",
  ]);
  await expect(page.locator("#history-more")).toBeHidden();
});

test("retries an unavailable history and fits a phone screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route("**/api/history?*", (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: {} });
    }
    return route.fulfill({
      json: result([
        ping(1, { title: "A".repeat(80), message: "B".repeat(160) }),
      ]),
    });
  });
  await page.goto("/history");
  await expect(page.locator("#history-status")).toHaveText(
    "History is unavailable. Try again.",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("#history-list li")).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".context/history-mobile.png",
    fullPage: true,
  });
  await page.locator("#history-search").fill("x".repeat(240));
  await expect(page.locator("#history-status")).toContainText("matches");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("ignores an old response after the search changes", async ({ page }) => {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/history?*", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "old") await waiting;
    await route.fulfill({ json: result([ping(1, { title: q || "Initial" })]) });
  });
  await page.goto("/history");
  await expect(page.locator("#history-list h3")).toHaveText(["Initial"]);
  const oldRequest = page.waitForRequest(/q=old$/);
  await page.locator("#history-search").fill("old");
  await oldRequest;
  await page.locator("#history-search").fill("new");
  await expect(page.locator("#history-list h3")).toHaveText(["new"]);
  release();
  await expect(page.locator("#history-list h3")).toHaveText(["new"]);
});

test("reads a real accepted ping from another browser after reload", async ({
  page,
  browser,
}) => {
  const title = `History integration ${Date.now()}`;
  const response = await page.request.post("/api/pings", {
    headers: { "CF-Connecting-IP": "192.0.2.200" },
    data: {
      latitude: -30,
      longitude: -100,
      title,
      message: "A shared history entry.",
    },
  });
  expect(response.status()).toBe(201);
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto(
      `${test.info().project.use.baseURL}/history?q=${encodeURIComponent(title)}`,
    );
    await expect(other.locator("#history-list h3")).toHaveText([title]);
    await other.reload();
    await expect(other.locator("#history-list h3")).toHaveText([title]);
    await other.screenshot({
      path: ".context/history-desktop.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
