import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: "dist/server",
    rollupOptions: {
      input: "src/server/index.ts",
    },
    ssr: "src/server/index.ts",
    target: "node22",
  },
});
