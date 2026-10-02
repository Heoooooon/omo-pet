import { defineConfig } from "vite";

// Tauri expects a fixed dev server port
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: "index.html",
        debug: "debug.html",
        settings: "settings.html",
      },
    },
  },
});
