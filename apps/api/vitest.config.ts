import { defineConfig } from "vitest/config";

/**
 * Integration tests talk to a real Postgres over the network, so the default
 * 5s timeout is a lie. Files run in parallel: each one owns a separate schema.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // A failed cleanup must not leave a schema behind silently.
    teardownTimeout: 30_000,
  },
});
