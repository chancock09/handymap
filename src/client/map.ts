import "./style.css";
import { setupFullscreen } from "./fullscreen";
import { geoNaturalEarth1, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { PULSE_MS, type Ping, type MapEvent, type ApiError } from "../protocol";

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const svg = document.getElementById("world") as unknown as SVGSVGElement;
const dots = element("dots");
const card = element("ping-card");
const form = element<HTMLFormElement>("ping-form");
const latitude = element<HTMLInputElement>("latitude");
const longitude = element<HTMLInputElement>("longitude");
const projection = geoNaturalEarth1().fitExtent(
  [
    [20, 15],
    [980, 545],
  ],
  { type: "Sphere" },
);
const path = geoPath(projection);
const topology = world as unknown as Topology<{
  countries: GeometryCollection;
}>;
const appendPath = (shape: Parameters<typeof path>[0], className: string) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
  node.setAttribute("d", path(shape) ?? "");
  node.setAttribute("class", className);
  svg.append(node);
};
appendPath({ type: "Sphere" }, "sphere");
appendPath(geoGraticule10(), "graticule");
for (const country of feature(topology, topology.objects.countries).features)
  appendPath(country, "land");

const pings = new Map<string, Ping>();
let serverOffset = 0;
let activeCard: string | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
const now = () => Date.now() + serverOffset;

function position(node: HTMLElement, point: [number, number]) {
  const projected = projection(point);
  if (!projected) return;
  node.style.left = `${projected[0] / 10}%`;
  node.style.top = `${projected[1] / 5.6}%`;
}

function closeCard(returnFocus = false) {
  if (returnFocus && activeCard)
    document.getElementById(`ping-${activeCard}`)?.focus();
  card.hidden = true;
  activeCard = null;
}

function placeCard() {
  if (!activeCard || card.hidden) return;
  const dot = document.getElementById(`ping-${activeCard}`);
  if (!dot) return closeCard();
  const bounds = dot.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const clamp = (value: number, available: number) =>
    Math.max(12, Math.min(value, available - 12));
  let left = clamp(
    bounds.left + bounds.width / 2 - width / 2,
    window.innerWidth - width,
  );
  let top = bounds.top - height - 14;
  if (top < 12) {
    top = bounds.bottom + 14;
    if (top + height > window.innerHeight - 12) {
      top = clamp(
        bounds.top + bounds.height / 2 - height / 2,
        window.innerHeight - height,
      );
      if (bounds.right + 14 + width <= window.innerWidth - 12) {
        left = bounds.right + 14;
      } else if (bounds.left - width - 14 >= 12) {
        left = bounds.left - width - 14;
      }
    }
  }
  card.style.left = `${left}px`;
  card.style.top = `${clamp(top, window.innerHeight - height)}px`;
}

function showCard(ping: Ping) {
  if (ping.expiresAt <= now()) return;
  clearTimeout(closeTimer);
  if (activeCard === ping.id && !card.hidden) return;
  activeCard = ping.id;
  element("card-title").textContent = ping.title;
  element("card-message").textContent = ping.message;
  element("card-location").textContent =
    `${Math.abs(ping.latitude).toFixed(2)}° ${ping.latitude < 0 ? "S" : "N"} / ${Math.abs(ping.longitude).toFixed(2)}° ${ping.longitude < 0 ? "W" : "E"}`;
  const picture = element("card-picture");
  const placeholder = document.createElement("span");
  placeholder.textContent = "✳";
  placeholder.setAttribute("aria-hidden", "true");
  picture.replaceChildren(placeholder);
  if (ping.imageUrl) {
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.addEventListener(
      "error",
      () => {
        if (picture.contains(img)) picture.replaceChildren(placeholder);
      },
      {
        once: true,
      },
    );
    img.src = ping.imageUrl;
    picture.replaceChildren(img);
  }
  card.hidden = false;
  updateCardTime();
  placeCard();
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (!card.matches(":hover") && !card.contains(document.activeElement))
      closeCard();
  }, 180);
}

card.addEventListener("mouseenter", () => clearTimeout(closeTimer));
card.addEventListener("mouseleave", scheduleClose);
card.addEventListener("focusout", scheduleClose);
element("close-card").addEventListener("click", () => closeCard(true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCard(true);
});
document.addEventListener("pointerdown", (event) => {
  if (
    !card.contains(event.target as Node) &&
    !(event.target as Element).closest(".dot")
  )
    closeCard();
});
window.addEventListener("resize", placeCard);
window.addEventListener("scroll", placeCard, { passive: true });
setupFullscreen(placeCard);

function addPing(ping: Ping, animate: boolean) {
  if (ping.expiresAt <= now() || pings.has(ping.id)) return;
  pings.set(ping.id, ping);
  const dot = document.createElement("button");
  dot.id = `ping-${ping.id}`;
  dot.className = "dot";
  dot.type = "button";
  dot.setAttribute("aria-label", `${ping.title}: ${ping.message}`);
  dot.setAttribute("aria-controls", "ping-card");
  position(dot, [ping.longitude, ping.latitude]);
  const age = Math.max(0, now() - ping.createdAt);
  if (animate && age < PULSE_MS) {
    dot.classList.add("pulse");
    dot.style.setProperty("--pulse-delay", `${-age / 1000}s`);
    dot.addEventListener("animationend", () => dot.classList.remove("pulse"), {
      once: true,
    });
  }
  dot.addEventListener("mouseenter", () => showCard(ping));
  dot.addEventListener("mouseleave", scheduleClose);
  dot.addEventListener("focus", () => showCard(ping));
  dot.addEventListener("blur", scheduleClose);
  dot.addEventListener("click", () => {
    showCard(ping);
    card.focus({ preventScroll: true });
  });
  dots.append(dot);
  updateCount();
}

function updateCount() {
  element("count").textContent = String(pings.size);
  element("count-label").textContent =
    pings.size === 1 ? "active ping" : "active pings";
  element("empty-message").textContent = pings.size
    ? "A small moment, somewhere in the world. Hover or tap a dot."
    : "The world is quiet. Be the first to send a ping.";
}

function updateCardTime() {
  if (!activeCard) return;
  const ping = pings.get(activeCard);
  if (!ping || ping.expiresAt <= now()) return closeCard();
  element("card-time").textContent =
    `Disappears in ${Math.ceil((ping.expiresAt - now()) / 1000)} seconds`;
}

setInterval(() => {
  for (const [id, ping] of pings) {
    if (ping.expiresAt > now()) continue;
    if (activeCard === id) closeCard();
    document.getElementById(`ping-${id}`)?.remove();
    pings.delete(id);
  }
  updateCount();
  updateCardTime();
}, 250);

function selectLocation() {
  const marker = element("selection");
  const lat = Number(latitude.value),
    lon = Number(longitude.value);
  const valid =
    latitude.value !== "" &&
    longitude.value !== "" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;
  marker.hidden = !valid;
  if (valid) position(marker, [lon, lat]);
}
latitude.addEventListener("input", selectLocation);
longitude.addEventListener("input", selectLocation);
svg.addEventListener("click", (event) => {
  const bounds = svg.getBoundingClientRect();
  const point: [number, number] = [
    ((event.clientX - bounds.left) / bounds.width) * 1000,
    ((event.clientY - bounds.top) / bounds.height) * 560,
  ];
  const coordinates = projection.invert?.(point);
  if (
    !coordinates ||
    Math.abs(coordinates[0]) > 180 ||
    Math.abs(coordinates[1]) > 90
  )
    return;
  const forward = projection(coordinates)!;
  if (Math.hypot(forward[0] - point[0], forward[1] - point[1]) > 1) return;
  latitude.value = coordinates[1].toFixed(4);
  longitude.value = coordinates[0].toFixed(4);
  selectLocation();
});

let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatDeadline: ReturnType<typeof setTimeout> | undefined;
let attempts = 0;
let stopped = false;
function connection(state: string, label: string, message = "") {
  const status = element("connection");
  status.dataset.state = state;
  status.textContent = label;
  element("connection-notice").hidden = !message;
  element("connection-message").textContent = message;
}
function connect() {
  if (stopped) return;
  clearTimeout(retryTimer);
  connection("connecting", "Connecting");
  const url = new URL("/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  clearInterval(heartbeatTimer);
  clearTimeout(heartbeatDeadline);
  const previous = socket;
  const current = new WebSocket(url);
  socket = current;
  previous?.close();
  current.addEventListener("open", () => {
    heartbeatTimer = setInterval(() => {
      if (current.readyState !== WebSocket.OPEN) return;
      current.send("heartbeat");
      heartbeatDeadline = setTimeout(
        () => current.close(4000, "heartbeat_timeout"),
        10_000,
      );
    }, 30_000);
  });
  current.addEventListener("message", (event) => {
    if (current !== socket) return;
    if (event.data === "alive") {
      clearTimeout(heartbeatDeadline);
      return;
    }
    let data: MapEvent;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    serverOffset = data.serverTime - Date.now();
    if (data.type === "snapshot") {
      closeCard();
      pings.clear();
      dots.replaceChildren();
      for (const ping of data.pings) addPing(ping, false);
      updateCount();
      attempts = 0;
      connection("live", "Live connection");
    } else if (data.type === "ping") addPing(data.ping, true);
  });
  current.addEventListener("close", (event) => {
    if (current !== socket) return;
    clearInterval(heartbeatTimer);
    clearTimeout(heartbeatDeadline);
    if (stopped) return;
    if (event.code === 1013) {
      connection(
        "offline",
        "At capacity",
        "The map has reached its viewer limit. Try to reconnect in a moment.",
      );
      return;
    }
    if (attempts >= 5) {
      connection(
        "offline",
        "Live pings unavailable",
        "The live service is unavailable. The free quota can cause this. Try again later.",
      );
      return;
    }
    const delay =
      Math.min(30_000, 1_000 * 2 ** attempts++) + Math.random() * 1_000;
    connection(
      "offline",
      "Reconnecting",
      "The connection stopped. We will try to reconnect. Existing dots still expire on time.",
    );
    retryTimer = setTimeout(connect, delay);
  });
}
element("reconnect").addEventListener("click", () => {
  attempts = 0;
  connect();
});
window.addEventListener("pagehide", () => {
  stopped = true;
  clearTimeout(retryTimer);
  clearInterval(heartbeatTimer);
  clearTimeout(heartbeatDeadline);
  socket?.close();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    stopped = false;
    connect();
  }
});
connect();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = element<HTMLButtonElement>("send");
  const status = element("form-status");
  const title = element<HTMLInputElement>("title").value.trim();
  const message = element<HTMLTextAreaElement>("message").value.trim();
  status.dataset.error = "false";
  if (
    !title ||
    [...title].length > 80 ||
    !message ||
    [...message].length > 160
  ) {
    status.dataset.error = "true";
    status.textContent =
      "Use 1–80 characters for the title and 1–160 for the sentence.";
    return;
  }
  const imageUrl = element<HTMLInputElement>("imageUrl").value.trim();
  button.disabled = true;
  status.textContent = "Sending your ping…";
  try {
    const response = await fetch("/api/pings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: Number(latitude.value),
        longitude: Number(longitude.value),
        title,
        message,
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
      throw new Error(failure.error.message);
    }
    const ping: Ping = await response.json();
    addPing(ping, true);
    status.textContent = "Your ping is on the map. Hello, world.";
  } catch (cause) {
    status.dataset.error = "true";
    status.textContent =
      cause instanceof Error &&
      cause.name !== "TypeError" &&
      cause.name !== "TimeoutError"
        ? cause.message
        : "We could not confirm your ping. Check the map before you try again.";
  } finally {
    button.disabled = false;
  }
});
