import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20000,
    // Markdown suites share a live shell session; run files sequentially.
    fileParallelism: false,
  },
});
