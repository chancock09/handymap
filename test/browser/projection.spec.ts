import { expect, test } from "@playwright/test";

test("uses Equal Earth for high latitude pings and map selections", async ({
  page,
}) => {
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    const time = Date.now();
    socket.send(
      JSON.stringify({
        type: "snapshot",
        serverTime: time,
        pings: [
          {
            id: "projection-check",
            latitude: 60,
            longitude: -120,
            title: "Northern signal",
            message: "Check the map projection.",
            createdAt: time,
            expiresAt: time + 62_000,
          },
        ],
      }),
    );
  });
  await page.goto("/");
  const dot = page.locator("#ping-projection-check");
  await expect(dot).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(async () => {
        const map = await page.locator("#world").boundingBox();
        const stage = await page.locator("#map-stage").boundingBox();
        return (
          map!.width <= stage!.width + 1 && map!.height <= stage!.height + 1
        );
      })
      .toBe(true);
    const map = (await page.locator("#world").boundingBox())!;
    const marker = (await dot.boundingBox())!;
    expect((marker.x + marker.width / 2 - map.x) / map.width).toBeCloseTo(
      0.2589255894,
      3,
    );
    expect((marker.y + marker.height / 2 - map.y) / map.height).toBeCloseTo(
      0.1553539667,
      3,
    );
    const target = {
      x: Math.round(map.x + map.width * 0.7410744106),
      y: Math.round(map.y + map.height * 0.1553539667),
    };
    await page.mouse.click(target.x, target.y);
    await expect(page.locator("#composer-dialog")).toBeVisible();
    await expect(page.locator("#title")).toBeFocused();
    await page.locator("#close-composer").click();
    expect(
      Math.abs(Number(await page.locator("#latitude").inputValue()) - 60),
    ).toBeLessThan(1);
    expect(
      Math.abs(Number(await page.locator("#longitude").inputValue()) - 120),
    ).toBeLessThan(1);
    await expect(page.locator("#selection")).toBeVisible();
    const selection = (await page.locator("#selection").boundingBox())!;
    expect(Math.abs(selection.x + selection.width / 2 - target.x)).toBeLessThan(
      0.1,
    );
    expect(
      Math.abs(selection.y + selection.height / 2 - target.y),
    ).toBeLessThan(0.1);
    const previous = await page.locator("#latitude").inputValue();
    await page.locator("#world").click({ position: { x: 1, y: 1 } });
    await expect(page.locator("#latitude")).toHaveValue(previous);
    await expect(page.locator("#composer-dialog")).not.toBeVisible();
  }
});
