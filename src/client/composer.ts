import type { ApiError, Ping } from "../protocol";

export function setupComposer(callbacks: {
  selectLocation: () => void;
  accepted: (ping: Ping) => void;
  beforeOpen: () => void;
}) {
  const get = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const dialog = get<HTMLDialogElement>("composer-dialog");
  const form = get<HTMLFormElement>("ping-form");
  const button = get<HTMLButtonElement>("send");
  const status = get("form-status");
  let step: "location" | "story" = "location";
  let returnFocus: HTMLElement = get("open-composer");
  let pending = false;
  let retryAt = 0;
  let retryTimer: ReturnType<typeof setInterval> | undefined;
  const field = (id: string) => get<HTMLInputElement | HTMLTextAreaElement>(id);

  function errorFor(id: string) {
    const input = field(id);
    const value = input.value.trim();
    if (id === "latitude" || id === "longitude") {
      const bound = id === "latitude" ? 90 : 180;
      return value === "" ||
        !Number.isFinite(Number(value)) ||
        Math.abs(Number(value)) > bound
        ? `Enter a number from −${bound} to ${bound}.`
        : "";
    }
    if (id === "title" || id === "message") {
      const max = id === "title" ? 80 : 160;
      return !value || [...value].length > max
        ? `Use 1–${max} characters for ${id === "title" ? "the title" : "the sentence"}.`
        : "";
    }
    if (!value) return "";
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password)
        return "Use an HTTPS URL without credentials.";
      if (value.length > 2048 || url.href.length > 2048)
        return "Use an image URL of 2,048 characters or fewer.";
    } catch {
      return "Enter a valid HTTPS image URL.";
    }
    return "";
  }

  function showError(id: string, message: string) {
    const error = get(`${id}-error`);
    error.textContent = message;
    error.hidden = !message;
    field(id).setAttribute("aria-invalid", String(Boolean(message)));
  }

  function showStep(next: typeof step) {
    step = next;
    get("location-step").hidden = step !== "location";
    get("story-step").hidden = step !== "story";
    get("change-location").textContent =
      `Change location · ${field("latitude").value}, ${field("longitude").value}`;
  }

  function validate(ids: string[]) {
    let first = "";
    for (const id of ids) {
      const message = errorFor(id);
      showError(id, message);
      if (message && !first) first = id;
    }
    if (!first) return true;
    showStep(
      first === "latitude" || first === "longitude" ? "location" : "story",
    );
    if (first === "imageUrl")
      get<HTMLDetailsElement>("image-options").open = true;
    field(first).focus();
    return false;
  }

  function close(restore = true) {
    dialog.close();
    document.body.classList.remove("composer-open");
    if (restore) returnFocus.focus({ preventScroll: true });
  }

  function open(next: typeof step, source = get("open-composer")) {
    callbacks.beforeOpen();
    returnFocus = source;
    showStep(next);
    dialog.showModal();
    document.body.classList.add("composer-open");
    field(next === "location" ? "latitude" : "title").focus();
  }

  get("open-composer").addEventListener("click", () =>
    open(errorFor("latitude") || errorFor("longitude") ? "location" : "story"),
  );
  get("close-composer").addEventListener("click", () => close());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  get("pick-location").addEventListener("click", () => {
    if (dialog.open) close();
    get("map-panel").scrollIntoView({ block: "start" });
    get("map-status").textContent =
      "Click the map to choose a location and write your update.";
    get("map-feedback").hidden = false;
  });
  get("enter-coordinates").addEventListener("click", () =>
    field("latitude").focus(),
  );
  const continueStory = () => {
    if (validate(["latitude", "longitude"])) {
      callbacks.selectLocation();
      showStep("story");
      field("title").focus();
    }
  };
  get("continue-story").addEventListener("click", continueStory);
  get("change-location").addEventListener("click", () => {
    showStep("location");
    field("latitude").focus();
  });

  for (const id of ["latitude", "longitude", "title", "message", "imageUrl"]) {
    field(id).addEventListener("input", () => {
      if (id === "title" || id === "message") {
        const length = [...field(id).value.trim()].length;
        const max = id === "title" ? 80 : 160;
        get(`${id}-count`).textContent = `${length} / ${max}`;
        if (length > max) showError(id, errorFor(id));
      }
      if (field(id).getAttribute("aria-invalid") === "true")
        showError(id, errorFor(id));
    });
  }

  function updateRetry() {
    const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    button.disabled = pending || remaining > 0;
    get("retry-countdown").hidden = remaining === 0;
    get("retry-countdown").textContent =
      remaining > 0 ? `Retry available in ${remaining} seconds.` : "";
    if (!remaining && retryTimer) {
      clearInterval(retryTimer);
      retryTimer = undefined;
      status.textContent =
        "You can try again now. Another ping can take the next slot.";
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending || retryAt > Date.now()) return;
    if (step === "location") return continueStory();
    if (!validate(["latitude", "longitude", "title", "message", "imageUrl"]))
      return;
    pending = true;
    button.disabled = true;
    status.dataset.error = "false";
    status.dataset.state = "pending";
    status.textContent = "Sending your ping…";
    const imageUrl = field("imageUrl").value.trim();
    try {
      const response = await fetch("/api/pings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: Number(field("latitude").value),
          longitude: Number(field("longitude").value),
          title: field("title").value.trim(),
          message: field("message").value.trim(),
          ...(imageUrl ? { imageUrl } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        let failure: ApiError;
        try {
          failure = await response.json();
        } catch {
          throw new Error("The live service is unavailable. Try again later.");
        }
        if (response.status === 429) {
          const header = response.headers.get("Retry-After");
          const seconds = header === null ? 0 : Number(header);
          const headerMs = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(header!) - Date.now();
          const delay = Math.max(
            0,
            Number(failure.error.retryAfterMs) || 0,
            headerMs || 0,
          );
          if (delay > 0) {
            retryAt = Date.now() + delay;
            retryTimer = setInterval(updateRetry, 250);
            if (failure.error.code === "daily_limit")
              throw new Error(
                `The daily limit is reached. Try again after ${new Date(retryAt).toLocaleString()}.`,
              );
          }
        }
        throw new Error(failure.error.message);
      }
      const ping: Ping = await response.json();
      status.dataset.state = "accepted";
      status.textContent = "Your ping is on the map. Hello, world.";
      if (dialog.open) close(false);
      callbacks.accepted(ping);
    } catch (cause) {
      const unconfirmed =
        cause instanceof Error &&
        ["TypeError", "TimeoutError", "SyntaxError"].includes(cause.name);
      status.dataset.state = unconfirmed ? "unconfirmed" : "rejected";
      status.dataset.error = "true";
      status.textContent =
        cause instanceof Error && !unconfirmed
          ? cause.message
          : "We could not confirm your ping. Check the map before you try again.";
      if (!dialog.open) open("story");
    } finally {
      pending = false;
      updateRetry();
    }
  });

  function fitDialog() {
    const viewport = window.visualViewport;
    dialog.style.setProperty(
      "--available-height",
      `${viewport?.height ?? innerHeight}px`,
    );
    dialog.style.setProperty(
      "--keyboard-offset",
      `${Math.max(0, innerHeight - (viewport?.height ?? innerHeight) - (viewport?.offsetTop ?? 0))}px`,
    );
  }
  window.visualViewport?.addEventListener("resize", fitDialog);
  window.visualViewport?.addEventListener("scroll", fitDialog);
  window.addEventListener("resize", fitDialog);
  fitDialog();
  showStep(step);

  return {
    locationSelected() {
      for (const id of ["latitude", "longitude"]) showError(id, errorFor(id));
      open("story");
    },
  };
}
