import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Dev: the browser talks to :5173 and Vite forwards /api and /ws to the FastAPI backend on :8000.
// Build: `base: "./"` lets the backend serve the result at http://localhost:8000/app/.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["src/test/setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
