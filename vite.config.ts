import { defineConfig } from "vitest/config";

// ブラウザα版のビルド設定。最終ターゲットはGodotのため、ここは使い捨て前提。
// ロジックは src/core（エンジン非依存）に閉じ込め、本ファイルはUI/配信のみを担う。
export default defineConfig({
  root: ".",
  build: {
    target: "es2022",
    outDir: "dist",
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
