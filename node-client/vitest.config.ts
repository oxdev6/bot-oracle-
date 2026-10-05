import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});