import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Calma Hotel System",
        short_name: "Calma",
        description: "نظام إدارة فندق Calma",
        theme_color: "#161D27",
        background_color: "#FBF9F4",
        display: "standalone",
        start_url: "/",
        dir: "rtl",
        lang: "ar",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    globals: true,
  },
});
