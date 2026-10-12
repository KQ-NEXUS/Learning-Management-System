import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Two Vitest projects (Vitest 4 `test.projects` API — NOT the Vitest 3
// `workspace` shape, which this version no longer reads):
//   - "node": the pre-existing node-mode suite, unchanged behaviour.
//   - "components": jsdom-backed .tsx component tests (D-19 keyboard
//     reorder, D-26 three-state readiness rendering). Kept as a narrow,
//     separate project so the much larger node suite never pays jsdom's
//     startup cost, and so a .tsx file is never picked up twice.
const alias = { "@": path.resolve(import.meta.dirname, "src") };

// CI's unit job sets VITEST_SKIP_INTEGRATION=1 so that it runs no
// *.integration.test.ts file (those need Docker and an object store and have
// their own sharded job). It has to be done here: with `projects`, the command
// line's `--exclude` does not reach a project's own file selection, so
// `--exclude "**/*.integration.test.ts"` left all of them in (checklist D-07).
// tests/ci-config.test.ts checks both ends of this switch.
const skipIntegration = process.env.VITEST_SKIP_INTEGRATION === "1";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          // Performance budgets (*.perf.test.ts) run on their own, sequentially,
          // via `npm run test:perf` (vitest.perf.config.mts): under a parallel
          // full run dozens of Postgres containers compete for the machine and a
          // timing budget fails for reasons unrelated to the code.
          exclude: [
            "tests/components/**",
            "tests/**/*.perf.test.ts",
            // *.smoke.test.ts is a manual live check (the Brevo smoke sends a real
            // email when BREVO_LIVE is set). It stays runnable by name on a
            // developer's machine and is never selected by the CI unit job.
            ...(skipIntegration ? ["tests/**/*.integration.test.ts", "tests/**/*.smoke.test.ts"] : []),
          ],
        },
      },
      {
        resolve: { alias },
        plugins: [react()],
        test: {
          name: "components",
          // jsdom suites do not manage external server processes. Threads
          // avoid Windows fork startup delays; node integration suites keep
          // their default process isolation for database/server lifecycle work.
          pool: "threads",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/components/setup.ts"],
        },
      },
    ],
  },
});
