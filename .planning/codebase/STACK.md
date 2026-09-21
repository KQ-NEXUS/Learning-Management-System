# Technology Stack

**Analysis Date:** 2026-09-01

## Languages

**Primary:**
- TypeScript 5 - All application code, configuration files, and tests
- JavaScript (ESM modules) - Configuration and build scripts

**Secondary:**
- SQL - Hand-written migrations in `prisma/sql/` for integrity constraints beyond Prisma's DDL capabilities

## Runtime

**Environment:**
- Node.js 24.6.0
- npm 11.5.1
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Next.js 16.3.4 - Full-stack framework with App Router, server components, route handlers, server actions
- React 19.2.8 - UI component library

**Styling:**
- Tailwind CSS 4 - Utility-first CSS framework
- @tailwindcss/postcss 4 - PostCSS integration for Tailwind

**Testing:**
- Vitest 4.1.11 - Unit testing framework, Node.js environment
- Config: `vitest.config.mts`
- Test location: `tests/**/*.test.ts`

**Build/Dev:**
- ESLint 9 - Linting with flat configuration
  - Config: `eslint.config.mjs`
  - Extends: `eslint-config-next` (core-web-vitals, typescript)
  - Custom rules: `@prisma/client` import restriction to service layer only
- PostCSS 4 - CSS processing pipeline for Tailwind
- tsx 4.23.13 - TypeScript executor for scripts (used for Prisma seed)

## Key Dependencies

**Critical:**
- @prisma/client 6.19.3 - PostgreSQL ORM and query builder
  - Restricted to `src/server/services/**/*.ts` and `src/server/db.ts` by ESLint
  - Caching strategy: PrismaClient singleton on `globalThis` in development to survive hot reload
  - Logging: Development logs warnings and errors; production logs errors only

**Infrastructure:**
- prisma 6.19.3 - ORM toolkit (CLI for migrations, introspection, studio)
  - Seed configuration: `prisma/seed.ts` executed via `tsx`
  - Migrations: `prisma/migrations/` with hand-written SQL in `prisma/sql/`
- @types/react 19 - React type definitions
- @types/react-dom 19 - React DOM type definitions
- @types/node 20 - Node.js type definitions
- eslint-config-next 16.3.4 - Next.js ESLint configuration

## Configuration

**TypeScript:**
- Target: ES2017
- Module: ES modules (esnext)
- Module resolution: bundler (Next.js recommended)
- Strict mode: enabled
- JSX: react-jsx
- Path aliases: `@/*` maps to `src/*`
- Plugins: Next.js TypeScript plugin
- Config file: `tsconfig.json`

**Build:**
- Next.js config: `next.config.ts` (minimal, no customization needed yet)
- ESLint: `eslint.config.mjs` (flat config, applies boundary rules)
- PostCSS: `postcss.config.mjs` (Tailwind integration)
- Vitest: `vitest.config.mts` (Node.js environment, path aliases)

**Application:**
- Environment: Loaded via `process.env.DATABASE_URL` for Prisma connection string
- `.env` and `.env.example` exist (secrets never committed per PRD PAY-14)

## Package Scripts

```bash
npm run dev           # Start Next.js development server with hot reload
npm run build         # Production build
npm run start         # Production server
npm run lint          # Run ESLint across all TypeScript files
npm run test          # Run Vitest suite once
npm run db:migrate    # Create and apply Prisma migrations
npm run db:seed       # Run seed script (prisma/seed.ts)
npm run db:studio     # Launch Prisma Studio for database exploration
```

## Platform Requirements

**Development:**
- Node.js 24.6.0 or compatible
- npm 11.5.1 or compatible
- PostgreSQL 12+ (for local development)
- Unix-like shell or Git Bash on Windows

**Production:**
- Node.js 24.6.0 (runtime)
- PostgreSQL 12+ (data store)
- Docker Compose (for orchestration per spec docs)

## Database

**Provider:** PostgreSQL

**Client:** @prisma/client 6.19.3

**Schema Location:** `prisma/schema.prisma` (1252 lines)

**Migrations:** `prisma/migrations/`
- `20260901115332_init` - Initial schema
- `20260901152759_login_throttling` - Login throttling (failedLoginAttempts, lockedUntil fields)
- Hand-written SQL: `prisma/sql/001_integrity.sql` for constraints Prisma cannot express:
  1. One ACTIVE enrolment per (userId, cohortId) — partial unique index
  2. Cohort targets exactly one Course XOR Programme — check constraint
  3. Cohort capacity under concurrent checkout — row-level locking

---

*Stack analysis: 2026-09-01*
