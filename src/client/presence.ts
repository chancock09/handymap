export function viewerId() {
  const key = "handymap-viewer";
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function showPresence(viewers: number) {
  const status = document.getElementById("presence")!;
  if (!Number.isSafeInteger(viewers) || viewers < 1) {
    status.textContent = "Online count unavailable";
    return;
  }
  const others = viewers - 1;
  status.textContent =
    others === 0
      ? "0 others online"
      : `${others} ${others === 1 ? "other" : "others"} online now`;
}
