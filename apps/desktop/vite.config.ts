import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/dist/**",
        "**/dist-studio/**",
        "**/*.tsbuildinfo",
      ],
    },
  },
  build: { target: ["es2022", "chrome105", "safari15"], sourcemap: true },
});
