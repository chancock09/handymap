import { expect, test, type WebSocketRoute } from "@playwright/test";

test("shows other visitors and counts another tab in the same browser once", async ({
  page,
  context,
  browser,
}) => {
  await page.goto("/");
  await expect(page.locator("#presence")).toHaveText("0 others online");
  const tab = await context.newPage();
  await tab.goto("/");
  await expect(tab.locator("#presence")).toHaveText("0 others online");
  const visitor = await browser.newContext();
  try {
    const other = await visitor.newPage();
    await other.goto("/");
    await expect(page.locator("#presence")).toHaveText("1 other online now");
    await expect(other.locator("#presence")).toHaveText("1 other online now");
    await tab.close();
    await expect(page.locator("#presence")).toHaveText("1 other online now");
  } finally {
    await visitor.close();
  }
  await expect(page.locator("#presence")).toHaveText("0 others online");
});

test("shows live counts on mobile and clears the count when disconnected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let socket: WebSocketRoute;
  await page.routeWebSocket(/\/ws(?:\?|$)/, (route) => {
    socket = route;
    route.send(
      JSON.stringify({
        type: "snapshot",
        pings: [],
        viewers: 4,
        serverTime: Date.now(),
      }),
    );
  });
  await page.goto("/");
  const presence = page.locator("#presence");
  await expect(presence).toHaveText("3 others online now");
  await expect(presence).toBeInViewport();
  await expect(page.locator("#map-title")).toHaveText(
    "A little hello. A whole world.",
  );
  await expect(page.locator("#world")).toBeInViewport();
  await expect(page.locator("#fullscreen")).toBeInViewport();
  socket!.send(
    JSON.stringify({ type: "presence", viewers: 2, serverTime: Date.now() }),
  );
  await expect(presence).toHaveText("1 other online now");
  socket!.close({ code: 1013 });
  await expect(presence).toHaveText("Online count unavailable");
  await page.locator("#reconnect").click();
  await expect(presence).toHaveText("3 others online now");
});

test("does not invent a count when the server omits presence", async ({
  page,
}) => {
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    socket.send(
      JSON.stringify({ type: "snapshot", pings: [], serverTime: Date.now() }),
    );
  });
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("Live connection");
  await expect(page.locator("#presence")).toHaveText(
    "Online count unavailable",
  );
});
