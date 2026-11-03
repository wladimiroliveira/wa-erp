import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadDotenv } from "./src/server/lib/dotenv.ts";

loadDotenv();

// src/server/lib/prisma.ts builds its client at import time, from DATABASE_URL. Handing the workers
// the test URL here is what keeps the suite off the development database: setting it inside a test
// file would already be too late, because the import chain ran first.
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "web",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/server/**", "src/shared/**"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/tests/setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "api",
          include: ["src/server/**/*.test.ts", "src/shared/**/*.test.ts", "prisma/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["src/server/**/*.integration.test.ts", "prisma/**/*.integration.test.ts"],
          environment: "node",
          globalSetup: ["./src/server/testing/database.global-setup.ts"],
          env: { DATABASE_URL: testDatabaseUrl },
          fileParallelism: false,
        },
      },
    ],
  },
});
