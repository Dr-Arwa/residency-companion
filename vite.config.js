import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      workbox: { globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"], navigateFallback: "index.html" },
      manifest: {
        name: "Doctor Arwa — Ophthalmology Ward Manager",
        short_name: "Doctor Arwa",
        description: "Ward, pre-op and discharge task manager",
        lang: "en",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#EBF1F0",
        theme_color: "#0D6B66",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
