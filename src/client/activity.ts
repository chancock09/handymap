import { setupTicker } from "./ticker";
import type { Ping } from "../protocol";

export function coordinates(ping: Pick<Ping, "latitude" | "longitude">) {
  return `${Math.abs(ping.latitude).toFixed(2)}° ${ping.latitude < 0 ? "S" : "N"} / ${Math.abs(ping.longitude).toFixed(2)}° ${ping.longitude < 0 ? "W" : "E"}`;
}

export function setupActivity(
  pings: Map<string, Ping>,
  now: () => number,
  open: (ping: Ping, source: HTMLElement) => void,
  dismiss: () => void,
) {
  const list = document.getElementById("ping-list")!;
  setupTicker(list);
  const dots = document.getElementById("dots")!;
  const title = document.getElementById("activity-title")!;
  const showAll = document.getElementById("show-all-pings")!;
  const filterLabel = document.getElementById("activity-filter")!;
  const rows = new Map<string, HTMLLIElement>();
  const clusters = new Map<
    string,
    { button: HTMLButtonElement; ids: string[] }
  >();
  let filter: Set<string> | null = null;
  let selected: string | null = null;

  function applyFilter() {
    for (const [id, row] of rows)
      row.hidden = filter !== null && !filter.has(id);
    showAll.hidden = filter === null;
    filterLabel.hidden = filter === null;
    if (filter) {
      const count = [...filter].filter((id) => pings.has(id)).length;
      filterLabel.textContent = count
        ? `${count} pings in this group`
        : "This group has expired.";
    }
  }

  function select(id: string | null) {
    selected = id;
    for (const [key, row] of rows)
      row
        .querySelector("button")!
        .setAttribute("aria-pressed", String(key === id));
    for (const dot of dots.querySelectorAll<HTMLElement>(".dot"))
      dot.classList.toggle("is-selected", dot.id === `ping-${id}`);
    for (const cluster of clusters.values())
      cluster.button.classList.toggle(
        "is-selected",
        id !== null && cluster.ids.includes(id),
      );
  }

  function refreshGroups() {
    const bounds = dots.getBoundingClientRect();
    const points = [...pings.keys()].map((id) => {
      const dot = document.getElementById(`ping-${id}`)!;
      return {
        id,
        dot,
        x: (parseFloat(dot.style.left) * bounds.width) / 100,
        y: (parseFloat(dot.style.top) * bounds.height) / 100,
      };
    });
    const groups: (typeof points)[] = [];
    const remaining = new Set(points);
    for (const point of points) {
      if (!remaining.delete(point)) continue;
      const group = [point];
      for (let index = 0; index < group.length; index++) {
        for (const candidate of remaining) {
          if (
            Math.abs(group[index].x - candidate.x) < 44 &&
            Math.abs(group[index].y - candidate.y) < 44
          ) {
            remaining.delete(candidate);
            group.push(candidate);
          }
        }
      }
      groups.push(group);
    }
    const keys = new Set<string>();
    for (const group of groups) {
      for (const point of group) point.dot.hidden = group.length > 1;
      if (group.length === 1) continue;
      const ids = group.map((point) => point.id);
      const key = [...ids].sort().join(",");
      keys.add(key);
      let cluster = clusters.get(key);
      if (!cluster) {
        const button = document.createElement("button");
        button.className = "cluster";
        button.type = "button";
        button.textContent = String(ids.length);
        button.setAttribute(
          "aria-label",
          `Read ${ids.length} overlapping pings`,
        );
        button.setAttribute("aria-controls", "ping-list");
        button.addEventListener("click", () => {
          dismiss();
          filter = new Set(ids);
          applyFilter();
          document.getElementById("activity-status")!.textContent =
            `${ids.length} pings in this group. Choose a title to read a ping.`;
          const first = ids.map((id) => rows.get(id)).find(Boolean);
          first?.querySelector("button")?.focus();
        });
        cluster = { button, ids };
        clusters.set(key, cluster);
        dots.append(button);
      }
      cluster.button.style.left = `${group.reduce((sum, point) => sum + parseFloat(point.dot.style.left), 0) / group.length}%`;
      cluster.button.style.top = `${group.reduce((sum, point) => sum + parseFloat(point.dot.style.top), 0) / group.length}%`;
      if (group.some((point) => point.dot === document.activeElement))
        cluster.button.focus({ preventScroll: true });
    }
    for (const [key, cluster] of clusters) {
      if (keys.has(key)) continue;
      if (cluster.button === document.activeElement)
        title.focus({ preventScroll: true });
      cluster.button.remove();
      clusters.delete(key);
    }
    select(selected);
  }

  showAll.addEventListener("click", () => {
    dismiss();
    filter = null;
    applyFilter();
    title.focus({ preventScroll: true });
  });
  new ResizeObserver(refreshGroups).observe(dots);

  return {
    select,
    refreshGroups,
    anchor(id: string) {
      const dot = document.getElementById(`ping-${id}`);
      return dot && !dot.hidden
        ? dot
        : [...clusters.values()].find((cluster) => cluster.ids.includes(id))
            ?.button;
    },
    add(ping: Ping) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ping-row";
      button.setAttribute("aria-controls", "ping-card");
      button.setAttribute("aria-label", `Read ${ping.title}`);
      button.setAttribute("aria-pressed", "false");
      const name = document.createElement("strong");
      name.textContent = ping.title;
      const location = document.createElement("span");
      location.className = "ping-location";
      location.textContent = coordinates(ping);
      const time = document.createElement("span");
      time.className = "ping-lifetime";
      time.textContent = `${Math.max(0, Math.ceil((ping.expiresAt - now()) / 1000))}s left`;
      button.append(name, location, time);
      button.addEventListener("click", () => open(ping, button));
      row.append(button);
      rows.set(ping.id, row);
      list.append(row);
      applyFilter();
      refreshGroups();
    },
    remove(id: string) {
      const row = rows.get(id);
      if (row?.contains(document.activeElement))
        title.focus({ preventScroll: true });
      row?.remove();
      rows.delete(id);
      applyFilter();
    },
    reset() {
      if (
        list.contains(document.activeElement) ||
        dots.contains(document.activeElement)
      )
        title.focus({ preventScroll: true });
      list.replaceChildren();
      rows.clear();
      clusters.clear();
      filter = null;
      applyFilter();
    },
    updateTime() {
      for (const [id, row] of rows) {
        const ping = pings.get(id);
        if (!ping) continue;
        const time = row.querySelector(".ping-lifetime")!;
        const text = `${Math.max(0, Math.ceil((ping.expiresAt - now()) / 1000))}s left`;
        if (time.textContent !== text) time.textContent = text;
      }
    },
  };
}
