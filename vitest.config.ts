import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", ".next", "src/**/*.test.tsx"],
    globals: false,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
  },
});
