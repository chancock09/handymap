export function setupTicker(list: HTMLElement) {
  const controls = document.getElementById("ticker-controls")!;
  const pause = document.getElementById("pause-feed") as HTMLButtonElement;
  const activity = document.querySelector<HTMLElement>(".activity")!;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = reducedMotion.matches;
  let hovering = false;
  let touching = false;
  let lastAdvance = performance.now();

  function update() {
    const overflow = list.scrollWidth > list.clientWidth + 1;
    if (!overflow && controls.contains(document.activeElement))
      document.getElementById("activity-title")!.focus({ preventScroll: true });
    controls.hidden = !overflow;
    pause.textContent = paused ? "Play" : "Pause";
    pause.setAttribute("aria-label", paused ? "Play feed" : "Pause feed");
    pause.setAttribute("aria-pressed", String(paused));
  }

  function advance(direction: number) {
    const items = [...list.children].filter(
      (node) => !(node as HTMLElement).hidden,
    ) as HTMLElement[];
    const current = list.scrollLeft;
    const positions = items.map((node) => node.offsetLeft);
    const end = list.scrollWidth - list.clientWidth;
    const next =
      direction > 0
        ? current >= end - 2
          ? 0
          : (positions.find((left) => left > current + 2) ?? end)
        : current <= 2
          ? end
          : (positions.reverse().find((left) => left < current - 2) ?? 0);
    list.scrollTo({
      left: next,
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });
    lastAdvance = performance.now();
  }

  pause.addEventListener("click", () => {
    paused = !paused;
    lastAdvance = performance.now();
    update();
  });
  for (const [id, direction] of [
    ["previous-ping", -1],
    ["next-ping", 1],
  ] as const) {
    document.getElementById(id)!.addEventListener("click", () => {
      paused = true;
      advance(direction);
      update();
    });
  }
  activity.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") hovering = true;
  });
  activity.addEventListener("pointerleave", () => {
    hovering = false;
    lastAdvance = performance.now();
  });
  list.addEventListener("pointerdown", () => {
    touching = true;
  });
  const release = () => {
    touching = false;
    lastAdvance = performance.now();
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  list.addEventListener(
    "wheel",
    () => {
      paused = true;
      update();
    },
    { passive: true },
  );
  activity.addEventListener("focusout", () => {
    lastAdvance = performance.now();
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) paused = true;
    update();
  });
  document.addEventListener("visibilitychange", () => {
    lastAdvance = performance.now();
  });
  setInterval(() => {
    if (
      paused ||
      hovering ||
      touching ||
      document.hidden ||
      controls.hidden ||
      list.contains(document.activeElement) ||
      document.querySelector("dialog[open]") ||
      !document.getElementById("ping-card")!.hidden
    ) {
      lastAdvance = performance.now();
      return;
    }
    if (performance.now() - lastAdvance >= 5000) advance(1);
  }, 250);
  new ResizeObserver(update).observe(list);
  new MutationObserver(update).observe(list, {
    childList: true,
    subtree: true,
    attributeFilter: ["hidden"],
  });
  update();
}
