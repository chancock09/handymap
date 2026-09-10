import assert from "node:assert/strict";
import https from "node:https";

const origin = new URL(process.argv[2] ?? "https://handymap.gobbi.tech");
assert.equal(origin.protocol, "https:");
const checks = [
  { path: "/" },
  { path: "/docs" },
  { path: "/favicon.svg" },
  { path: "/_gate-check-asset.js" },
  { path: "/healthz" },
  {
    path: "/api/pings",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  },
  {
    path: "/api/pings",
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  },
  {
    path: "/ws",
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    },
  },
];
for (const { path, method = "GET", headers = {}, body } of checks) {
  await new Promise((resolve, reject) => {
    const request = https.request(
      new URL(path, origin),
      { method, headers },
      (response) => {
        response.resume();
        try {
          if (method === "OPTIONS") {
            assert.equal(
              response.statusCode,
              403,
              "Access must deny anonymous preflight",
            );
            assert.equal(
              response.headers["access-control-allow-origin"],
              undefined,
            );
          } else {
            assert.equal(
              response.statusCode,
              302,
              `${method} ${path} must redirect to Access`,
            );
            const target = new URL(response.headers.location);
            assert.equal(target.protocol, "https:");
            assert.equal(target.hostname, "gobbi-tech.cloudflareaccess.com");
            assert.equal(
              target.pathname,
              `/cdn-cgi/access/login/${origin.hostname}`,
            );
          }
          response.on("end", resolve);
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("Anonymous WebSocket upgrade passed the Access gate"));
    });
    request.on("error", reject);
    request.setTimeout(15_000, () =>
      request.destroy(new Error("Access check timed out")),
    );
    request.end(body);
  });
  console.log(`${method} ${path}: Access login required`);
}
