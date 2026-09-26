import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: false,
    clearMocks: true,
    // Never talk to a real database from unit/authorization tests.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test_should_never_connect",
    },
  },
});
