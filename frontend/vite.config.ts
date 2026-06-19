import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  // 多页构建（additive）：默认应用 index.html 行为不变，额外产出独立展示页 showcase.html。
  // 相对路径以 root（frontend）解析，避免依赖 node:url 类型（仓库未装 @types/node）。
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        showcase: "showcase.html",
      },
    },
  },
});
