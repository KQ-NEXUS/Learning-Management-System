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

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/components/**"],
        },
      },
      {
        resolve: { alias },
        plugins: [react()],
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/components/setup.ts"],
        },
      },
    ],
  },
});
