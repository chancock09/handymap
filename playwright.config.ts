import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  use: {
    baseURL: "http://127.0.0.1:8787",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run build && npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to .context/browser-state/${Date.now()}`,
    url: "http://127.0.0.1:8787/healthz",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
