import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // 各工具的后端代理（Rust 服务，默认 8787 端口）
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
})
