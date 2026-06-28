import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Dev: proxy API + WebSocket to the in-process Fastify panel server.
// Prod: `vite build` emits to dist/, which Fastify serves directly.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Don't enable the SW in `vite dev`. It would cache the dev server and
      // fight the /api + /ws proxy, so it only ships in the production build.
      devOptions: { enabled: false },
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "fonts/*.woff2"],
      manifest: {
        name: "MyHQ",
        short_name: "HQ",
        description: "Personal AI command center for managing your Atlas fleet.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#5d62d1",
        background_color: "#0a0a0b",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the static app shell (hashed JS/CSS/HTML + icons/fonts).
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // SPA navigation fallback to the cached shell, but never hijack the
        // panel API or the WebSocket handshake.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        runtimeCaching: [
          {
            // API: always try the network first so data stays fresh; fall back
            // to the last cached response only when offline.
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Static assets (anything not /api, /ws): serve from cache first.
            urlPattern: ({ url, request }) =>
              !url.pathname.startsWith("/api") &&
              !url.pathname.startsWith("/ws") &&
              request.method === "GET",
            handler: "CacheFirst",
            options: {
              cacheName: "static-cache",
              expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
