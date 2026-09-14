import "./history.css";
import { coordinates } from "./activity";
import type { HistoryPage, Ping } from "../protocol";

const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const search = get<HTMLInputElement>("history-search");
const status = get("history-status");
const list = get("history-list");
const more = get<HTMLButtonElement>("history-more");
const retry = get<HTMLButtonElement>("history-retry");
const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const count = new Intl.NumberFormat();
let next: number | null = null;
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryOlder = false;

function row(ping: Ping) {
  const item = document.createElement("li");
  const title = document.createElement("h3");
  title.textContent = ping.title;
  const message = document.createElement("p");
  message.className = "history-message";
  message.textContent = ping.message;
  const meta = document.createElement("p");
  meta.className = "history-meta";
  const place = document.createElement("span");
  place.textContent = coordinates(ping);
  const time = document.createElement("time");
  time.dateTime = new Date(ping.createdAt).toISOString();
  time.textContent = timeFormat.format(ping.createdAt);
  meta.append(place, time);
  if (ping.imageUrl) {
    const link = document.createElement("a");
    link.href = ping.imageUrl;
    link.rel = "noreferrer noopener";
    link.target = "_blank";
    link.textContent = "Image ↗";
    meta.append(link);
  }
  item.append(title, message, meta);
  return item;
}

async function load(older = false) {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  const query = search.value.trim();
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (older && next !== null) params.set("before", String(next));
  if (!older) {
    next = null;
    list.replaceChildren();
    more.hidden = true;
  }
  more.disabled = true;
  retry.hidden = true;
  status.textContent = "Loading pings…";
  list.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`/api/history?${params}`, {
      signal: request.signal,
    });
    if (!response.ok) throw new Error("History request failed.");
    const result = (await response.json()) as HistoryPage;
    if (request.signal.aborted) return;
    list.append(...result.pings.map(row));
    next = result.next;
    more.hidden = next === null;
    status.textContent =
      result.total === 0
        ? query
          ? `No pings match “${query}”.`
          : "No pings yet."
        : `${count.format(result.total)} ${result.total === 1 ? "ping" : "pings"}${query ? ` ${result.total === 1 ? "matches" : "match"} “${query}”` : " in the public history"}.`;
  } catch {
    if (request.signal.aborted) return;
    retryOlder = older;
    retry.hidden = false;
    status.textContent = "History is unavailable. Try again.";
  } finally {
    if (!request.signal.aborted) {
      more.disabled = false;
      list.setAttribute("aria-busy", "false");
    }
  }
}

function updateSearch(delay: number) {
  clearTimeout(timer);
  controller?.abort();
  next = null;
  more.hidden = true;
  retry.hidden = true;
  list.replaceChildren();
  status.textContent = "Loading pings…";
  const url = new URL(location.href);
  if (search.value.trim()) url.searchParams.set("q", search.value.trim());
  else url.searchParams.delete("q");
  history.replaceState(null, "", url);
  timer = setTimeout(() => void load(), delay);
}
search.value = new URL(location.href).searchParams.get("q") ?? "";
search.addEventListener("input", () => updateSearch(300));
get("history-form").addEventListener("submit", (event) => {
  event.preventDefault();
  updateSearch(0);
});
more.addEventListener("click", () => void load(true));
retry.addEventListener("click", () => void load(retryOlder));
void load();
