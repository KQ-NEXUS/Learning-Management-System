import { defineConfig } from "vitest/config";
import path from "node:path";

// Performance budgets only (tests/**/*.perf.test.ts), one file at a time so a
// timing assertion measures the code, not machine contention. Run with
// `npm run test:perf`; the main config excludes these files.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    name: "perf",
    environment: "node",
    include: ["tests/**/*.perf.test.ts"],
    fileParallelism: false,
  },
});
