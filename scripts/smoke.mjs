import assert from "node:assert/strict";
const origin = new URL(process.argv[2] ?? "https://handymap.gobbi.tech");
for (const path of ["/", "/docs", "/healthz"]) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(
    response.status,
    200,
    `${path} must return 200 without an Access redirect`,
  );
  await response.arrayBuffer();
  console.log(`${path}: public`);
}
const preflight = await fetch(new URL("/api/pings", origin), {
  method: "OPTIONS",
  redirect: "manual",
  signal: AbortSignal.timeout(15_000),
  headers: {
    Origin: "https://example.com",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "Content-Type",
  },
});
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
console.log("/api/pings: public preflight");
const url = new URL("/ws", origin);
url.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
await new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error("WebSocket snapshot timed out"));
  }, 15_000);
  socket.addEventListener(
    "message",
    (event) => {
      clearTimeout(timeout);
      try {
        const data = JSON.parse(event.data);
        assert.equal(data.type, "snapshot");
        assert.ok(Array.isArray(data.pings));
        socket.close(1000);
        resolve();
      } catch (error) {
        socket.close();
        reject(error);
      }
    },
    { once: true },
  );
  socket.addEventListener(
    "error",
    () => {
      clearTimeout(timeout);
      reject(new Error("Public WebSocket connection failed"));
    },
    { once: true },
  );
  socket.addEventListener(
    "close",
    (event) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket closed before snapshot: ${event.code}`));
    },
    { once: true },
  );
});
console.log("/ws: public snapshot");
