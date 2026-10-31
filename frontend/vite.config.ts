import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Bygget hamnar i app/public, som Bun serverar statiskt. Under utveckling proxas /api och /auth
 * till den körande tjänsten, så att cookien och inloggningen är densamma som i drift.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../app/public", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3011", changeOrigin: false },
      "/auth": { target: "http://127.0.0.1:3011", changeOrigin: false },
    },
  },
});
