import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: { input: { map: "index.html", docs: "docs/index.html" } },
  },
});
