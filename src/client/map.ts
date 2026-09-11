import "./style.css";
import { setupFullscreen } from "./fullscreen";
import { setupComposer } from "./composer";
import { showPresence, viewerId } from "./presence";
import { coordinates, setupActivity } from "./activity";
import { geoEqualEarth, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import { PULSE_MS, type Ping, type MapEvent } from "../protocol";

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const svg = document.getElementById("world") as unknown as SVGSVGElement;
const dots = element("dots");
const card = element("ping-card");
const latitude = element<HTMLInputElement>("latitude");
const longitude = element<HTMLInputElement>("longitude");
const projection = geoEqualEarth().fitExtent(
  [
    [6, 4],
    [994, 556],
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
let cardSource: HTMLElement | null = null;
let cardPinned = false;
let acceptedPing: Ping | null = null;
const activity = setupActivity(
  pings,
  now,
  (ping, source) => {
    showCard(ping, source, true);
    card.focus({ preventScroll: true });
  },
  () => closeCard(),
);

function position(node: HTMLElement, point: [number, number]) {
  const projected = projection(point);
  if (!projected) return;
  node.style.left = `${projected[0] / 10}%`;
  node.style.top = `${projected[1] / 5.6}%`;
}

function closeCard(returnFocus = false) {
  clearTimeout(closeTimer);
  if (returnFocus) {
    const source =
      cardSource?.isConnected &&
      cardSource.getClientRects().length > 0 &&
      !cardSource.matches(":disabled")
        ? cardSource
        : element("activity-title");
    source.focus({ preventScroll: true });
  }
  card.hidden = true;
  activeCard = null;
  cardPinned = false;
  activity.select(null);
}

function placeCard() {
  if (!activeCard || card.hidden) return;
  const dot = activity.anchor(activeCard);
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

function showCard(
  ping: Ping,
  source = document.getElementById(`ping-${ping.id}`)!,
  pinned = false,
) {
  if (ping.expiresAt <= now()) return;
  clearTimeout(closeTimer);
  cardSource = source;
  cardPinned = pinned;
  activity.select(ping.id);
  if (activeCard === ping.id && !card.hidden) return;
  activeCard = ping.id;
  element("card-title").textContent = ping.title;
  element("card-message").textContent = ping.message;
  element("card-location").textContent = coordinates(ping);
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
    if (
      !cardPinned &&
      !card.matches(":hover") &&
      !card.contains(document.activeElement)
    )
      closeCard();
  }, 180);
}

card.addEventListener("mouseenter", () => clearTimeout(closeTimer));
card.addEventListener("mouseleave", scheduleClose);
card.addEventListener("focusout", scheduleClose);
element("close-card").addEventListener("click", () => closeCard(true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !card.hidden) closeCard(true);
});
document.addEventListener("pointerdown", (event) => {
  if (
    !card.contains(event.target as Node) &&
    !(event.target as Element).closest(".dot, .cluster, .ping-row, #view-ping")
  )
    closeCard();
});
window.addEventListener("resize", placeCard);
window.addEventListener("scroll", placeCard, { passive: true });

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
    showCard(ping, dot, true);
    card.focus({ preventScroll: true });
  });
  dots.append(dot);
  activity.add(ping);
  updateCount();
}

function updateCount() {
  element("count").textContent = String(pings.size);
  element("count-label").textContent =
    pings.size === 1 ? "active ping" : "active pings";
  const live = element("connection").dataset.state === "live";
  element("activity-empty").hidden = pings.size > 0;
  element("activity-empty").textContent = live
    ? "No active pings. Pick a spot to send the first one."
    : "Waiting for a live connection.";
}

function updateCardTime() {
  if (!activeCard) return;
  const ping = pings.get(activeCard);
  if (!ping || ping.expiresAt <= now()) return closeCard();
  element("card-time").textContent =
    `Disappears in ${Math.ceil((ping.expiresAt - now()) / 1000)} seconds`;
}

setInterval(() => {
  let changed = false;
  for (const [id, ping] of pings) {
    if (ping.expiresAt > now()) continue;
    if (activeCard === id) {
      element("activity-status").textContent = "The open ping has expired.";
      closeCard(card.contains(document.activeElement));
    }
    const dot = document.getElementById(`ping-${id}`);
    if (dot === document.activeElement)
      element("activity-title").focus({ preventScroll: true });
    dot?.remove();
    pings.delete(id);
    activity.remove(id);
    changed = true;
  }
  if (changed) activity.refreshGroups();
  if (acceptedPing && acceptedPing.expiresAt <= now()) {
    acceptedPing = null;
    if (document.activeElement === element("view-ping"))
      element("activity-title").focus({ preventScroll: true });
    element<HTMLButtonElement>("view-ping").disabled = true;
    element("map-status").textContent =
      "Your ping has expired. Send another little hello.";
  }
  updateCount();
  updateCardTime();
  activity.updateTime();
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
  if (valid) {
    element("map-feedback").hidden = true;
    position(marker, [lon, lat]);
  }
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
  composer.locationSelected();
});

function revealAccepted() {
  if (!acceptedPing || acceptedPing.expiresAt <= now()) return;
  element("map-panel").scrollIntoView({ block: "start" });
  showCard(acceptedPing, element("view-ping"), true);
  card.focus({ preventScroll: true });
}
element("view-ping").addEventListener("click", revealAccepted);
const composer = setupComposer({
  selectLocation,
  beforeOpen: () => closeCard(),
  accepted(ping) {
    acceptedPing = ping;
    addPing(ping, true);
    activity.select(ping.id);
    element("selection").hidden = true;
    element("map-feedback").hidden = false;
    const expired = ping.expiresAt <= now();
    element("map-status").textContent = expired
      ? "Your ping has expired. Send another little hello."
      : "Your ping is on the map. Hello, world.";
    element("view-ping").hidden = false;
    element<HTMLButtonElement>("view-ping").disabled = expired;
    if (expired) element("open-composer").focus();
    else revealAccepted();
  },
});
setupFullscreen(() => {
  activity.refreshGroups();
  placeCard();
});

let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatDeadline: ReturnType<typeof setTimeout> | undefined;
let attempts = 0;
let stopped = false;
const viewer = viewerId();
function connection(state: string, label: string, message = "") {
  const status = element("connection");
  status.dataset.state = state;
  status.textContent = label;
  if (state !== "live")
    element("presence").textContent =
      state === "connecting"
        ? "Checking who’s here…"
        : "Online count unavailable";
  element("connection-notice").hidden = !message;
  element("connection-message").textContent = message;
  updateCount();
}
function connect() {
  if (stopped) return;
  clearTimeout(retryTimer);
  connection("connecting", "Connecting");
  const url = new URL("/ws", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("viewer", viewer);
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
      closeCard(card.contains(document.activeElement));
      activity.reset();
      pings.clear();
      dots.replaceChildren();
      for (const ping of data.pings) addPing(ping, false);
      updateCount();
      attempts = 0;
      connection("live", "Live connection");
      showPresence(data.viewers);
    } else if (data.type === "presence") {
      showPresence(data.viewers);
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
