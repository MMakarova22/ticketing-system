import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the SPA runs on Vite (5173) and proxies /api to the NestJS server on port 3000,
// so the browser sees a single origin (same as production, where NestJS serves the built SPA).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
