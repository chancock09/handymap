import { expect, test, type Page } from "@playwright/test";

async function openMap(page: Page) {
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) =>
    socket.send(
      JSON.stringify({
        type: "snapshot",
        serverTime: Date.now(),
        pings: [
          {
            latitude: 0,
            longitude: 0,
            title: "Full-screen signal",
            message: "The card stays with the map.",
            id: "fullscreen-check",
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
          },
        ],
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator("#ping-fullscreen-check")).toBeVisible();
}

async function expectMapFits(page: Page) {
  await expect
    .poll(async () => {
      const stage = await page.locator("#map-stage").boundingBox();
      const map = await page.locator("#map").boundingBox();
      return map!.width <= stage!.width + 1 && map!.height <= stage!.height + 1;
    })
    .toBe(true);
  const stage = await page.locator("#map-stage").boundingBox();
  const map = await page.locator("#map").boundingBox();
  const dot = await page.locator("#ping-fullscreen-check").boundingBox();
  expect(map!.width).toBeLessThanOrEqual(stage!.width + 1);
  expect(map!.height).toBeLessThanOrEqual(stage!.height + 1);
  expect(map!.width / map!.height).toBeCloseTo(1000 / 560, 2);
  expect(dot!.x + dot!.width / 2).toBeCloseTo(map!.x + map!.width / 2, 0);
  expect(dot!.y + dot!.height / 2).toBeCloseTo(map!.y + map!.height / 2, 0);
}

test("opens native full screen with working cards and exits from its button", async ({
  page,
}) => {
  await openMap(page);
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.id))
    .toBe("map-panel");
  await expect(
    page.getByRole("button", { name: "Exit full screen" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectMapFits(page);
  await page.locator("#ping-fullscreen-check").click();
  await expect(page.locator("#ping-card")).toBeVisible();
  expect(
    await page
      .locator("#ping-card")
      .evaluate((node) => document.fullscreenElement!.contains(node)),
  ).toBe(true);
  await page.screenshot({ path: ".context/handymap-fullscreen.png" });
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement))
    .toBeNull();
  await expect(
    page.getByRole("button", { name: "Full screen", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.locator("#open-composer").click();
  await expect(page.locator("#latitude")).toBeEditable();
});

test("restores the page after Escape and a browser full-screen exit", async ({
  page,
}) => {
  await openMap(page);
  const button = page.locator("#fullscreen");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.id))
    .toBe("map-panel");
  await page.evaluate(() => document.exitFullscreen());
  await expect(button).toHaveText("Full screen");
  await expect(button).toBeFocused();
});

for (const unsupported of [true, false]) {
  test(`fills the mobile viewport when full screen is ${unsupported ? "unavailable" : "denied"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((unsupported) => {
      Object.defineProperty(document, "fullscreenEnabled", {
        value: !unsupported,
      });
      if (!unsupported)
        Element.prototype.requestFullscreen = () =>
          Promise.reject(new TypeError("Denied"));
    }, unsupported);
    await openMap(page);
    await page
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    await expect(page.locator("#fullscreen")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    const panel = await page.locator("#map-panel").boundingBox();
    expect(panel).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await expectMapFits(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect
      .poll(
        async () => (await page.locator("#map-panel").boundingBox())?.height,
      )
      .toBe(390);
    await expectMapFits(page);
    await page.locator("#ping-fullscreen-check").click();
    await expect(page.locator("#ping-card")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#fullscreen")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
}
