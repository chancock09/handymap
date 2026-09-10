import { expect, test, type Page } from "@playwright/test";

async function openFeed(page: Page, count = 7) {
  await page.routeWebSocket("**/ws", (socket) => {
    const time = Date.now();
    socket.send(
      JSON.stringify({
        type: "snapshot",
        serverTime: time,
        pings: Array.from({ length: count }, (_, index) => ({
          id: `ticker-${index}`,
          latitude: 0,
          longitude: -140 + index * 40,
          title: `Signal ${index + 1}`,
          message: "A little hello.",
          createdAt: time,
          expiresAt: time + 62_000,
        })),
      }),
    );
    socket.onMessage((message) => {
      if (message === "heartbeat") socket.send("alive");
    });
  });
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("Live connection");
}

const scroll = (page: Page) =>
  page.locator("#ping-list").evaluate((node) => node.scrollLeft);

test("keeps the map, send action, and horizontal feed within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFeed(page);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#open-composer")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".activity")).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#world")).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        })),
      )
      .toEqual(viewport);
  }
});

test("advances the feed and pauses for hover, explicit pause, and keyboard focus", async ({
  page,
}) => {
  await page.clock.install();
  await openFeed(page);
  await page.clock.fastForward(5500);
  await expect.poll(() => scroll(page)).toBeGreaterThan(100);
  await expect.poll(() => scroll(page)).toBe(384);
  await page.locator(".activity").hover();
  const beforeHover = await scroll(page);
  await page.clock.fastForward(6000);
  expect(await scroll(page)).toBe(beforeHover);
  await page.locator("#pause-feed").click();
  await expect(page.locator("#pause-feed")).toHaveAttribute(
    "aria-label",
    "Play feed",
  );
  await page.locator(".brand").hover();
  await page.clock.fastForward(6000);
  expect(await scroll(page)).toBe(beforeHover);
  await page.locator("#pause-feed").click();
  await page.locator(".ping-row").nth(2).focus();
  const beforeFocus = await scroll(page);
  await page.locator(".brand").hover();
  await page.clock.fastForward(6000);
  expect(await scroll(page)).toBe(beforeFocus);
  await page.keyboard.press("Enter");
  await expect(page.locator("#card-title")).toHaveText("Signal 3");
  await page.locator("#close-card").click();
  await expect(page.locator(".ping-row").nth(2)).toBeFocused();
});

test("starts paused with reduced motion and supports manual navigation in both directions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await openFeed(page);
  await expect(page.locator("#pause-feed")).toHaveAttribute(
    "aria-label",
    "Play feed",
  );
  await page.clock.fastForward(6000);
  expect(await scroll(page)).toBe(0);
  await page.locator("#next-ping").click();
  await expect.poll(() => scroll(page)).toBe(290);
  await page.locator("#previous-ping").click();
  await expect.poll(() => scroll(page)).toBe(0);
  await page.locator("#previous-ping").click();
  const end = await page
    .locator("#ping-list")
    .evaluate((node) => node.scrollWidth - node.clientWidth);
  await expect.poll(() => scroll(page)).toBe(end);
  await page.locator("#next-ping").click();
  await expect.poll(() => scroll(page)).toBe(0);
});

test("removes expired feed items and hides controls when the feed is empty", async ({
  page,
}) => {
  await page.clock.install();
  await openFeed(page);
  await page.locator("#pause-feed").click();
  await page.clock.fastForward(62_000);
  await expect(page.locator(".ping-row")).toHaveCount(0);
  await expect(page.locator("#ticker-controls")).toBeHidden();
  await expect(page.locator("#activity-title")).toBeFocused();
  await expect(page.locator("#activity-empty")).toContainText(
    "No active pings",
  );
});
