import { expect, test, type Page } from "@playwright/test";

const payload = {
  latitude: 37.7749,
  longitude: -122.4194,
  title: "Browser check",
  message: "A shared signal.",
};
// A fresh address per submission isolates the source limit across tests and worker restarts.
let sources = 0;
const freshSource = () => {
  const worker = test.info().workerIndex;
  return {
    "CF-Connecting-IP": `10.${worker >> 8}.${worker & 255}.${++sources}`,
  };
};
function submitFromFreshSource(page: Page) {
  return page.route(/\/api\/(?:browser-pings|pings)$/, (route) =>
    route.continue({
      headers: { ...route.request().headers(), ...freshSource() },
    }),
  );
}
async function submit(page: Page, data = payload) {
  const headers = freshSource();
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await page.request.post("/api/pings", { data, headers });
    if (response.status() === 201) return response.json();
    expect(response.status()).toBe(429);
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Number(response.headers()["retry-after"]) * 1000 + 50,
      ),
    );
  }
  throw new Error("The API did not accept the test ping.");
}

test("shows the same real ping in two browsers and a fresh page", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const second = await context.newPage();
  await second.goto("/");
  await expect(
    page.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  await expect(
    second.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  const ping = await submit(page);
  for (const viewer of [page, second])
    await expect(viewer.locator(`#ping-${ping.id}`)).toBeVisible();
  await second.reload();
  await expect(second.locator(`#ping-${ping.id}`)).toBeVisible();
  await expect(second.locator(`#ping-${ping.id}`)).not.toHaveClass(/pulse/);
  await page.locator(`#ping-${ping.id}`).hover();
  await expect(page.locator("#card-title")).toHaveText(payload.title);
  await expect(page.locator("#card-message")).toHaveText(payload.message);
  await page.keyboard.press("Escape");
  await expect(page.locator("#ping-card")).toBeHidden();
});

test("submits through the form and keeps text inert", async ({ page }) => {
  await submitFromFreshSource(page);
  await page.goto("/");
  await page.locator("#open-composer").click();
  await page.getByLabel("Latitude", { exact: true }).fill("0");
  await page.getByLabel("Longitude", { exact: true }).fill("0");
  await page.locator("#continue-story").click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("<img src=x onerror=alert(1)>");
  await page.getByLabel("A short sentence").fill("Text stays text.");
  let dialog = false;
  page.on("dialog", async (item) => {
    dialog = true;
    await item.dismiss();
  });
  await page.waitForTimeout(1050);
  await page.getByRole("button", { name: "Send ping" }).click();
  await expect(page.locator("#form-status")).toHaveText(
    "Your ping is on the map. Hello, world.",
  );
  const dot = page.getByRole("button", {
    name: "<img src=x onerror=alert(1)>: Text stays text.",
  });
  await dot.focus();
  await expect(page.locator("#card-title")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#card-title img")).toHaveCount(0);
  expect(dialog).toBe(false);
});

test("expires sixty seconds after creation without a reconnect extension", async ({
  page,
}) => {
  let send: (message: string) => void;
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    send = (message) => socket.send(message);
    socket.send(
      JSON.stringify({ type: "snapshot", pings: [], serverTime: Date.now() }),
    );
  });
  await page.goto("/");
  await expect(
    page.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  // Install the fake clock after the socket opens so a fast-forward cannot fire the real
  // heartbeat deadline and force a reconnect, and pause it so slow setup cannot eat the lifetime.
  const loaded = Date.now();
  await page.clock.install({ time: loaded });
  const start = loaded + 10_000;
  await page.clock.pauseAt(start);
  const ping = {
    ...payload,
    id: "lifetime",
    createdAt: start,
    expiresAt: start + 60_000,
  };
  send!(JSON.stringify({ type: "ping", ping, serverTime: start }));
  await expect(page.locator("#ping-lifetime")).toHaveClass(/pulse/);
  await page.clock.fastForward(2_000);
  await expect(page.locator("#ping-lifetime")).toBeVisible();
  send!(
    JSON.stringify({
      type: "snapshot",
      pings: [ping],
      serverTime: start + 2_000,
    }),
  );
  await expect(page.locator("#ping-lifetime")).not.toHaveClass(/pulse/);
  await page.locator("#ping-lifetime").focus();
  await page.clock.fastForward(57_000);
  await expect(page.locator("#ping-lifetime")).toBeVisible();
  await page.clock.fastForward(1_000);
  await expect(page.locator("#ping-lifetime")).toHaveCount(0);
  await expect(page.locator("#ping-card")).toBeHidden();
});

test("shows capacity and allows a manual reconnect", async ({ page }) => {
  let connections = 0;
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    if (++connections === 1)
      socket.close({ code: 1013, reason: "viewer_capacity" });
    else
      socket.send(
        JSON.stringify({ type: "snapshot", pings: [], serverTime: Date.now() }),
      );
  });
  await page.goto("/");
  await expect(page.getByText("At capacity", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(
    page.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  expect(connections).toBe(2);
});

test("shows a failed submission without adding a dot", async ({ page }) => {
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) =>
    socket.send(
      JSON.stringify({ type: "snapshot", pings: [], serverTime: Date.now() }),
    ),
  );
  await page.route("**/api/browser-pings", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "rate_limited",
          message: "The map accepts one ping per second. Try again later.",
        },
      }),
    }),
  );
  await page.goto("/");
  await page.locator("#open-composer").click();
  await page.getByLabel("Latitude", { exact: true }).fill("1");
  await page.getByLabel("Longitude", { exact: true }).fill("1");
  await page.locator("#continue-story").click();
  await page.getByLabel("Title", { exact: true }).fill("A signal");
  await page.getByLabel("A short sentence").fill("Try again.");
  await page.getByRole("button", { name: "Send ping" }).click();
  await expect(page.locator("#form-status")).toContainText(
    "one ping per second",
  );
  await expect(page.locator(".dot")).toHaveCount(0);
});

test("loads external images only for open cards and uses a placeholder on failure", async ({
  page,
}) => {
  let imageRequests = 0;
  await page.route("https://images.example.test/**", (route) => {
    imageRequests++;
    return route.abort();
  });
  await page.goto("/");
  const ping = await submit(page, {
    ...payload,
    title: "Image signal",
    imageUrl: "https://images.example.test/broken.png",
  } as typeof payload);
  const row = page.getByRole("button", {
    name: "Read Image signal",
    exact: true,
  });
  await expect(row).toBeVisible();
  expect(imageRequests).toBe(0);
  await row.click();
  await expect(page.locator("#card-picture span")).toBeVisible();
  expect(imageRequests).toBe(1);
});

test("supports touch, screen bounds, map selection, and reduced motion", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(
    page.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  await page.locator("#world").tap({ position: { x: 240, y: 70 } });
  await expect(page.locator("#latitude")).not.toHaveValue("");
  await expect(page.locator("#title")).toBeFocused();
  await page.locator("#close-composer").click();
  const ping = await submit(page, {
    ...payload,
    latitude: -35,
    longitude: 150,
    title: "Hello from a phone",
  });
  const dot = page.locator(`#ping-${ping.id}`);
  await dot.tap();
  await expect(page.locator("#ping-card")).toBeVisible();
  const card = await page.locator("#ping-card").boundingBox();
  expect(card!.x).toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width).toBeLessThanOrEqual(390);
  expect(card!.y + card!.height).toBeLessThanOrEqual(844);
  expect(
    await dot.evaluate(
      (node) => getComputedStyle(node, "::before").animationName,
    ),
  ).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: ".context/handymap-mobile.png",
    fullPage: true,
  });
  await context.close();
});

test("serves the API guide and runs its JavaScript example against the service", async ({
  page,
}) => {
  await submitFromFreshSource(page);
  await page.goto("/docs");
  await expect(
    page.getByRole("heading", { name: "Send your first ping" }),
  ).toBeVisible();
  const code = await page.locator("#js-example").textContent();
  expect(code).toContain("http://127.0.0.1:8787/api/pings");
  await page.waitForTimeout(5050);
  await page.evaluate(async (source) => {
    await new Function(`return (async () => { ${source} })()`)();
  }, code);
  await page.goto("/");
  await expect(
    page.getByRole("button", {
      name: "Read Hello from San Francisco",
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: ".context/handymap-desktop.png",
    fullPage: true,
  });
});

test("reconnects after connection loss and replaces the previous snapshot", async ({
  page,
}) => {
  let connections = 0;
  let disconnect: () => void;
  const ping = {
    ...payload,
    id: "reconnect-check",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    connections++;
    disconnect = () => socket.close({ code: 1011, reason: "test_disconnect" });
    socket.send(
      JSON.stringify({
        type: "snapshot",
        pings: connections === 1 ? [ping] : [],
        serverTime: Date.now(),
      }),
    );
  });
  await page.goto("/");
  await expect(page.locator("#ping-reconnect-check")).toBeVisible();
  disconnect!();
  await expect(page.getByText("Reconnecting", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Live connection", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#ping-reconnect-check")).toHaveCount(0);
  expect(connections).toBe(2);
});

test("shows a service error from the API", async ({ page }) => {
  await page.route("**/api/browser-pings", (route) =>
    route.fulfill({
      status: 503,
      contentType: "text/html",
      body: "<h1>Service unavailable</h1>",
    }),
  );
  await page.goto("/");
  await page.locator("#open-composer").click();
  await page.getByLabel("Latitude", { exact: true }).fill("0");
  await page.getByLabel("Longitude", { exact: true }).fill("0");
  await page.locator("#continue-story").click();
  await page.getByLabel("Title", { exact: true }).fill("A signal");
  await page.getByLabel("A short sentence").fill("Try again later.");
  await page.getByRole("button", { name: "Send ping" }).click();
  await expect(page.locator("#form-status")).toHaveText(
    "The live service is unavailable. Try again later.",
  );
  await expect(page.getByRole("button", { name: "Send ping" })).toBeEnabled();
});
