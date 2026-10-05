import assert from "node:assert/strict";
import https from "node:https";

const origin = new URL(
  process.argv.slice(2).find((arg) => arg !== "--before-deploy") ??
    "https://hello-world.gobbi.tech",
);
assert.equal(origin.protocol, "https:");
const checks = [
  { path: "/", status: 200 },
  { path: "/docs", status: 200 },
  ...(process.argv.includes("--before-deploy")
    ? []
    : [
        { path: "/history", status: 200 },
        { path: "/api/history?limit=1", status: 200 },
        { path: "/api/history?q=smoke&limit=1", status: 200 },
        { path: "/api/history", method: "OPTIONS", status: 204 },
        { path: "/robots.txt", status: 200 },
        { path: "/sitemap.xml", status: 200 },
        { path: "/share.png", status: 200 },
      ]),
  { path: "/favicon.svg", status: 200 },
  { path: "/healthz", status: 200 },
  {
    path: "/api/pings",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    status: 400,
  },
  {
    path: "/api/pings",
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
    status: 204,
  },
];
for (const { path, method = "GET", headers = {}, body, status } of checks) {
  await new Promise((resolve, reject) => {
    const request = https.request(
      new URL(path, origin),
      { method, headers },
      (response) => {
        response.resume();
        try {
          const location = response.headers.location ?? "";
          assert.ok(
            !location.includes("cloudflareaccess.com"),
            `${method} ${path} redirected to the Access login`,
          );
          assert.equal(
            response.statusCode,
            status,
            `${method} ${path} must return ${status}`,
          );
          if (method === "OPTIONS")
            assert.equal(response.headers["access-control-allow-origin"], "*");
          response.on("end", resolve);
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("error", reject);
    request.setTimeout(15_000, () =>
      request.destroy(new Error("Public access check timed out")),
    );
    request.end(body);
  });
  console.log(`${method} ${path}: ${status} without an Access redirect`);
}
