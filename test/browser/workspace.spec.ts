import { expect, test, type Page } from "@playwright/test";
import type { Ping } from "../../src/protocol";

function ping(id: string, longitude = -50, lifetime = 60_000): Ping {
  return {
    id,
    latitude: 0,
    longitude,
    title: `Hello ${id}`,
    message: "A little hello.",
    createdAt: Date.now(),
    expiresAt: Date.now() + lifetime,
  };
}

async function openMap(page: Page, pings: Ping[] = []) {
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    socket.send(
      JSON.stringify({ type: "snapshot", pings, serverTime: Date.now() }),
    );
    socket.onMessage((message) => {
      if (message === "heartbeat") socket.send("alive");
    });
  });
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("Live connection");
}

async function fillForm(page: Page) {
  await page.locator("#open-composer").click();
  await page.getByLabel("Latitude", { exact: true }).fill("0");
  await page.getByLabel("Longitude", { exact: true }).fill("0");
  await page.locator("#continue-story").click();
  await page.getByLabel("Title", { exact: true }).fill("A signal");
  await page
    .getByLabel("A short sentence", { exact: true })
    .fill("Hello world.");
}

test("sends from the mobile map, preserves the draft, and reveals the accepted ping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/pings", (route) =>
    route.fulfill({
      status: 201,
      json: { ...ping("accepted"), ...route.request().postDataJSON() },
    }),
  );
  await openMap(page);
  await expect(page.locator("#open-composer")).toBeInViewport();
  await expect(page.locator("#world")).toBeInViewport();
  await page.locator("#open-composer").click();
  await page.getByRole("button", { name: "Pick on map", exact: true }).click();
  await expect(page.locator("#composer-dialog")).not.toBeVisible();
  await page.locator("#world").click({ position: { x: 180, y: 90 } });
  await expect(page.locator("#composer-dialog")).toBeVisible();
  await expect(page.locator("#title")).toBeFocused();
  await page.locator("#title").fill("Hello from a phone");
  await page.locator("#message").fill("The draft stays here.");
  await expect(page.locator("#imageUrl")).not.toBeVisible();
  await page.getByRole("button", { name: "Close composer" }).click();
  await expect(page.locator("#open-composer")).toBeFocused();
  await page.locator("#open-composer").click();
  await expect(page.locator("#title")).toHaveValue("Hello from a phone");
  await page.locator("#send").click();
  await expect(page.locator("#composer-dialog")).not.toBeVisible();
  await expect(page.locator("#card-title")).toHaveText("Hello from a phone");
  await expect(page.locator("#ping-card")).toBeFocused();
  await expect(page.locator("#ping-accepted")).toHaveClass(/is-selected/);
  await page.screenshot({
    path: ".context/handymap-improved-mobile.png",
    fullPage: true,
  });
  await page.locator("#close-card").click();
  await expect(page.locator("#view-ping")).toBeFocused();
});

test("validates manual coordinates in the mobile location step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await page.locator("#open-composer").click();
  await page.locator("#latitude").fill("91");
  await page.locator("#longitude").fill("0");
  await page.locator("#continue-story").click();
  await expect(page.locator("#latitude")).toBeFocused();
  await expect(page.locator("#latitude")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.locator("#latitude").fill("0");
  await page.locator("#continue-story").click();
  await expect(page.locator("#title")).toBeFocused();
  await page.setViewportSize({ width: 390, height: 440 });
  await expect
    .poll(async () => {
      const bounds = await page.locator("#composer-dialog").boundingBox();
      return bounds!.y >= 0 && bounds!.y + bounds!.height <= 441;
    })
    .toBe(true);
  await page.locator("#message").scrollIntoViewIfNeeded();
  await expect(page.locator("#message")).toBeInViewport({ ratio: 1 });
  expect(
    await page.locator("#message").evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return (
        document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        ) === node
      );
    }),
  ).toBe(true);
  await page.locator("#send").scrollIntoViewIfNeeded();
  await expect(page.locator("#send")).toBeInViewport({ ratio: 1 });
  await page.locator("#change-location").click();
  await expect(page.locator("#latitude")).toHaveValue("0");
  await page.keyboard.press("Escape");
  await expect(page.locator("#open-composer")).toBeFocused();
});

test("counts trimmed Unicode code points and focuses field errors before a request", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/pings", (route) => {
    requests++;
    return route.fulfill({
      status: 201,
      json: { ...ping("unicode"), ...route.request().postDataJSON() },
    });
  });
  await openMap(page);
  await fillForm(page);
  await page.locator("#title").fill(` ${"🌍".repeat(81)} `);
  await page.locator("#message").fill("x".repeat(161));
  await expect(page.locator("#title-count")).toHaveText("81 / 80");
  await page.locator("#send").click();
  await expect(page.locator("#title")).toBeFocused();
  await expect(page.locator("#title-error")).toBeVisible();
  expect(requests).toBe(0);
  await page.locator("#title").fill(` ${"🌍".repeat(80)} `);
  await page.locator("#send").click();
  await expect(page.locator("#message")).toBeFocused();
  await page.locator("#message").fill("x".repeat(160));
  await page.locator("#image-options summary").click();
  await page.locator("#imageUrl").fill("http://example.com/image.png");
  await page.locator("#send").click();
  await expect(page.locator("#imageUrl")).toBeFocused();
  await page.locator("#imageUrl").fill("");
  await page.locator("#send").click();
  await expect(page.locator("#form-status")).toHaveAttribute(
    "data-state",
    "accepted",
  );
  expect(requests).toBe(1);
});

test("opens all overlapping pings, keeps row order, and moves focus after expiry", async ({
  page,
}) => {
  await page.clock.install();
  await openMap(page, [ping("one", -50, 5000), ping("two"), ping("three")]);
  await page.getByRole("button", { name: "Read 3 overlapping pings" }).click();
  await expect(
    page.getByRole("button", { name: "Read Hello one", exact: true }),
  ).toBeFocused();
  for (const id of ["one", "two", "three"]) {
    await page
      .getByRole("button", { name: `Read Hello ${id}`, exact: true })
      .click();
    await expect(page.locator("#card-title")).toHaveText(`Hello ${id}`);
    await page.locator("#close-card").click();
    await expect(
      page.getByRole("button", { name: `Read Hello ${id}`, exact: true }),
    ).toBeFocused();
  }
  await page
    .getByRole("button", { name: "Read Hello one", exact: true })
    .click();
  await page.clock.fastForward(5000);
  await expect(page.locator("#ping-card")).not.toBeVisible();
  await expect(page.locator("#activity-title")).toBeFocused();
  await expect(page.locator("#activity-status")).toHaveText(
    "The open ping has expired.",
  );
  await expect(page.locator(".ping-row strong")).toHaveText([
    "Hello two",
    "Hello three",
  ]);
  await expect(
    page.getByRole("button", { name: "Read 2 overlapping pings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all", exact: true }).click();
  await expect(page.locator("#activity-filter")).not.toBeVisible();
});

test("recalculates overlap groups after a viewport change", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, [ping("west", -50), ping("east", -20)]);
  await expect(page.locator(".cluster")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".cluster")).toHaveCount(0);
  await expect(page.locator("#ping-west")).toBeVisible();
  await expect(page.locator("#ping-east")).toBeVisible();
  await page.screenshot({
    path: ".context/handymap-improved-desktop.png",
    fullPage: true,
  });
});

test("waits for the server retry interval without an automatic submission", async ({
  page,
}) => {
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/pings", (route) => {
    requests++;
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "3" },
      json: {
        error: {
          code: "rate_limited",
          message: "The map accepts one ping per second. Try again later.",
          retryAfterMs: 2000,
        },
      },
    });
  });
  await openMap(page);
  await fillForm(page);
  await page.locator("#send").click();
  await expect(page.locator("#send")).toBeDisabled();
  await expect(page.locator("#retry-countdown")).toContainText("3 seconds");
  await page.clock.fastForward(2000);
  await expect(page.locator("#send")).toBeDisabled();
  await page.clock.fastForward(1000);
  await expect(page.locator("#send")).toBeEnabled();
  await expect(page.locator("#title")).toHaveValue("A signal");
  expect(requests).toBe(1);
});

test("shows the daily reset in local time and preserves unconfirmed requests", async ({
  page,
}) => {
  await page.clock.install();
  let requests = 0;
  await page.route("**/api/pings", (route) => {
    requests++;
    if (requests > 1) return route.abort();
    return route.fulfill({
      status: 429,
      headers: { "Retry-After": "10" },
      json: {
        error: {
          code: "daily_limit",
          message: "The daily limit is reached.",
          retryAfterMs: 10000,
        },
      },
    });
  });
  await openMap(page);
  await fillForm(page);
  await page.locator("#send").click();
  await expect(page.locator("#form-status")).toContainText("Try again after");
  await expect(page.locator("#send")).toBeDisabled();
  await page.clock.fastForward(10000);
  await page.locator("#send").click();
  await expect(page.locator("#form-status")).toHaveAttribute(
    "data-state",
    "unconfirmed",
  );
  await expect(page.locator("#form-status")).toContainText(
    "Check the map before you try again",
  );
  await expect(page.locator("#title")).toHaveValue("A signal");
  expect(requests).toBe(2);
});

test("uses the composer inside full screen and keeps Escape within the dialog", async ({
  page,
}) => {
  await openMap(page);
  await page.locator("#fullscreen").click();
  await page.locator("#open-composer").click();
  await expect(page.locator("#composer-dialog")).toBeVisible();
  await page.locator("#latitude").fill("0");
  await page.locator("#longitude").fill("0");
  await page.locator("#continue-story").click();
  await page.locator("#title").fill("Draft in full screen");
  await page.keyboard.press("Escape");
  await expect(page.locator("#composer-dialog")).not.toBeVisible();
  await expect(page.locator("#fullscreen")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#fullscreen").click();
  await page.locator("#open-composer").click();
  await expect(page.locator("#title")).toHaveValue("Draft in full screen");
  await expect(page.locator("#title")).toBeEditable();
});

test("distinguishes an unavailable connection from a quiet map", async ({
  page,
}) => {
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) =>
    socket.close({ code: 1013 }),
  );
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("At capacity");
  await expect(page.locator("#activity-empty")).toHaveText(
    "Waiting for a live connection.",
  );
});

test("expires the accepted ping without leaving focus on a disabled view action", async ({
  page,
}) => {
  await page.clock.install();
  await page.route("**/api/pings", (route) =>
    route.fulfill({
      status: 201,
      json: { ...ping("short", 0, 5000), ...route.request().postDataJSON() },
    }),
  );
  await openMap(page);
  await fillForm(page);
  await page.locator("#send").click();
  await expect(page.locator("#ping-card")).toBeFocused();
  await expect(page.locator("#selection")).not.toBeVisible();
  await page.clock.fastForward(5000);
  await expect(page.locator("#view-ping")).toBeDisabled();
  await expect(page.locator("#activity-title")).toBeFocused();
  await expect(page.locator("#map-status")).toContainText(
    "Your ping has expired",
  );
  await expect(page.locator(".ping-row")).toHaveCount(0);
});
