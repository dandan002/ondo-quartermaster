import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = process.env.ONDO_SERVER ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: server, changeOrigin: false },
      "/auth": { target: server, changeOrigin: false },
      "/scim": { target: server, changeOrigin: false },
    },
  },
  test: { environment: "jsdom" },
} as never);
