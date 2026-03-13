import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5433/finbot_test",
      JWT_SECRET: "test-secret",
    },
  },
});
