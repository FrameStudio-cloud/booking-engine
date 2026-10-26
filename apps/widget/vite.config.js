import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    // One self-contained IIFE file the customer pastes into their site.
    lib: {
      entry: "src/main.jsx",
      name: "BookingWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    cssCodeSplit: false,
    minify: "esbuild",
    rollupOptions: {
      output: { assetFileNames: "widget.[ext]" },
    },
  },
});
