import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // The default worker-thread pool hangs on some Windows/Node 22 setups.
    // Forked processes are slower to start but reliable everywhere.
    pool: "forks",
  },
});