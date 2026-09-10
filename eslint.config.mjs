import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Claude Design export: static spec sheet plus its generated canvas
    // runtime. Reference material, not application code.
    "design/**",

    // Tooling and planning material, not application code (and all
    // gitignored). ESLint 9's flat config does not read .gitignore, so these
    // must be listed or `eslint .` lints the GSD CLI's own .cjs scripts.
    ".claude/**",
    ".planning/**",
    "reference/**",
  ]),

  // Data access is confined to the service layer.
  //
  // Every protected operation must be authorized server-side (PRD RBAC-06,
  // NFR-05). The App Router exposes four independent entry points — server
  // components, route handlers, server actions, middleware — so the boundary
  // is enforced here rather than left to convention.
  //
  // See docs/superpowers/specs/2026-09-01-track-a-foundation-design.md (D2).
  {
    files: ["src/**/*.{ts,tsx}", "netlify/functions/**/*.{ts,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              message:
                "Data access is confined to src/server/services/. Call a service instead — see docs/superpowers/specs/2026-09-01-track-a-foundation-design.md (D2).",
            },
          ],
        },
      ],
    },
  },

  // The allow-list must come after the restriction: flat config applies
  // later blocks over earlier ones.
  {
    files: ["src/server/services/**/*.ts", "src/server/db.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);

export default eslintConfig;
