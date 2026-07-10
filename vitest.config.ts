import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/tests/unit/**/*.test.ts"],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/*/tests/integration/**/*.test.ts"],
          fileParallelism: false,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: "dashboard",
          include: ["apps/dashboard/tests/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          passWithNoTests: true,
        },
      },
    ],
  },
});
