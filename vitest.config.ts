import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    fileParallelism: false,
    include: ["test/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
