export function setupFullscreen(placeCard: () => void) {
  const panel = document.getElementById("map-panel")!;
  const stage = document.getElementById("map-stage")!;
  const map = document.getElementById("map")!;
  const button = document.getElementById("fullscreen") as HTMLButtonElement;
  let expanded = false;

  function fitMap() {
    const { width, height } = stage.getBoundingClientRect();
    map.style.width = `${Math.floor(Math.min(width, (height * 1000) / 560))}px`;
    placeCard();
  }

  function setExpanded(active: boolean) {
    expanded = active;
    panel.classList.toggle("is-expanded", active);
    document.body.classList.toggle("map-expanded", active);
    button.textContent = active ? "Exit full screen" : "Full screen";
    button.setAttribute("aria-pressed", String(active));
    fitMap();
    button.focus({ preventScroll: true });
  }

  async function toggle() {
    button.disabled = true;
    try {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
      } else if (expanded) {
        setExpanded(false);
      } else {
        try {
          if (!document.fullscreenEnabled)
            throw new Error("Fullscreen unavailable");
          await panel.requestFullscreen();
        } catch {
          setExpanded(true);
        }
      }
    } catch {
      setExpanded(document.fullscreenElement === panel);
    } finally {
      button.disabled = false;
      button.focus({ preventScroll: true });
    }
  }

  button.addEventListener("click", () => {
    void toggle();
  });
  document.addEventListener("fullscreenchange", () => {
    setExpanded(document.fullscreenElement === panel);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && expanded && !button.disabled) void toggle();
  });
  new ResizeObserver(fitMap).observe(stage);
  window.addEventListener("resize", fitMap);
}
