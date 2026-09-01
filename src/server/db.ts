/**
 * The Prisma client singleton.
 *
 * This file and `src/server/services/**` are the only places permitted to
 * import `@prisma/client` — enforced by the ESLint rule in eslint.config.mjs.
 * See docs/superpowers/specs/2026-09-01-track-a-foundation-design.md (D2).
 *
 * Next.js hot-reloads modules in development, which would otherwise open a
 * new connection pool on every edit until Postgres refuses them. Caching the
 * instance on globalThis survives the reload.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
