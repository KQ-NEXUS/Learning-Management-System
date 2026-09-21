# Codebase Structure

**Analysis Date:** 2026-09-01

## Directory Layout

```
lms/
├── .claude/                    # Claude Code configuration and skills
│   ├── agents/
│   ├── commands/
│   ├── gsd-core/
│   ├── hooks/
│   └── scripts/
├── .planning/                  # Planning and analysis outputs
│   └── codebase/               # Generated codebase maps
├── .next/                      # Next.js build output (ignored)
├── design/                     # Design specifications and assets
├── docs/                       # Project documentation
│   ├── reference/
│   └── superpowers/            # GSD workflow documentation
├── prisma/                     # Database schema and migrations
│   ├── migrations/
│   ├── sql/                    # Hand-written integrity constraints
│   ├── schema.prisma           # Data model (PostgreSQL)
│   └── seed.ts                 # Database seeding script
├── public/                     # Static assets (favicon, etc.)
├── src/                        # Application source code
│   ├── app/                    # Next.js App Router (pages and routes)
│   │   ├── (auth)/             # Route group for auth pages
│   │   │   └── signin/         # Sign-in page and form
│   │   ├── staff/              # Staff workspace pages
│   │   │   ├── courses/        # Course management
│   │   │   ├── cohorts/        # (stub)
│   │   │   └── layout.tsx      # Staff nav shell
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Root page (redirect)
│   │   └── globals.css         # Global styles (Tailwind)
│   ├── components/             # Reusable UI components
│   │   └── primitives/         # Design primitives (6 components, ~40 screens)
│   │       ├── ResourceTable.tsx
│   │       ├── ResourceForm.tsx
│   │       ├── DetailLayout.tsx
│   │       ├── ConfirmModal.tsx
│   │       ├── index.ts        # Barrel export
│   │       └── (StatusPill, DetailFacts exported within)
│   ├── lib/                    # Utility functions (empty - reserved)
│   └── server/                 # Backend (server actions, services, auth)
│       ├── auth/               # Authentication and session
│       │   ├── current-actor.ts
│       │   ├── session-service.ts
│       │   ├── lockout.ts
│       │   └── password.ts
│       ├── permissions/        # Authorization and access control
│       │   ├── with-permission.ts   # Main factory
│       │   ├── catalogue.ts         # Permission enum
│       │   ├── scope.ts             # Scope resolution
│       │   └── index.ts             # Live bindings
│       ├── services/           # Business logic and CRUD
│       │   ├── resource-service.ts  # Factory for CRUD services
│       │   ├── course-service.ts    # Courses CRUD
│       │   ├── auth-service.ts      # Sign-in/session logic
│       │   ├── grant-service.ts     # Permission grant loading
│       │   ├── audit-service.ts     # Audit event recording
│       │   └── session-service.ts   # Session lookup
│       ├── audit/              # (stub - audit logic in services)
│       ├── payments/           # (stub - payment logic not yet implemented)
│       └── db.ts               # Prisma client singleton
├── tests/                      # Unit and integration tests
│   ├── *.test.ts               # Vitest test files
│   └── fixtures/               # (future) Test data
├── eslint.config.mjs           # ESLint configuration
├── tailwind.config.ts          # Tailwind CSS configuration
├── tsconfig.json               # TypeScript configuration with @ path alias
├── next.config.ts              # Next.js configuration
├── package.json                # Dependencies and scripts
└── README.md                   # (not present in current tree)
```

## Directory Purposes

**`.claude/`:**
- Purpose: Claude Code configuration, project skills, GSD workflow hooks
- Contains: Agent definitions, command scripts, skill configurations
- Key files: `.claude/gsd-core/` (GSD framework reference)

**`.planning/codebase/`:**
- Purpose: Generated codebase analysis documents
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Key files: These documents are read by `/gsd-plan-phase` and `/gsd-execute-phase`

**`design/`:**
- Purpose: UI design specifications, component mockups
- Contains: Design assets, visual guidelines
- Key files: Referenced by component development

**`docs/`:**
- Purpose: Project documentation
- Contains: Requirements, specifications, workflow docs
- Key files: `docs/superpowers/specs/` (dated requirement docs)

**`prisma/`:**
- Purpose: Database schema, migrations, integrity constraints
- Contains: Prisma schema file, migration history, hand-written SQL
- Key files: 
  - `prisma/schema.prisma` - Data model (140+ fields across 30+ models)
  - `prisma/migrations/` - Timestamped database changes
  - `prisma/sql/001_integrity.sql` - Three constraints beyond Prisma's DSL

**`src/app/`:**
- Purpose: Next.js App Router — all web routes and pages
- Contains: Route groups, page components, server actions, styling
- Key files:
  - `src/app/(auth)/signin/` - Sign-in page, form, submission action
  - `src/app/staff/` - Staff workspace (courses, cohorts, enrolments, etc.)
  - `src/app/layout.tsx` - Root HTML shell
  - `src/app/page.tsx` - Root redirect (authenticated → staff, anonymous → signin)
  - `src/app/globals.css` - Tailwind and custom styles

**`src/components/primitives/`:**
- Purpose: Reusable UI components powering 40+ screens
- Contains: Table, form, layout, modal, status components
- Key files:
  - `ResourceTable.tsx` - List view with filtering, sorting, pagination
  - `ResourceForm.tsx` - Create/edit form with validation
  - `DetailLayout.tsx` - Single-record detail view container
  - `ConfirmModal.tsx` - Confirmation dialog
  - `index.ts` - Barrel export of all primitives

**`src/server/auth/`:**
- Purpose: Authentication, session management, password handling
- Contains: Session CRUD, lockout tracking, password hashing
- Key files:
  - `current-actor.ts` - Reads session cookie, returns authenticated user
  - `session-service.ts` - Creates, revokes, validates sessions
  - `lockout.ts` - Brute-force protection (failedLoginAttempts tracking)
  - `password.ts` - Password hashing and verification

**`src/server/permissions/`:**
- Purpose: Authorization, permission matching, access control
- Contains: Grant validation, scope resolution, permission catalogue
- Key files:
  - `with-permission.ts` - Authorization factory (single choke point)
  - `catalogue.ts` - Enumerated permissions (e.g., "courses.view")
  - `scope.ts` - Grant matching logic for scoped access (GLOBAL, COURSE, COHORT)
  - `index.ts` - Live bindings (getCurrentActor + services wired together)

**`src/server/services/`:**
- Purpose: Business logic, domain operations, CRUD with audit
- Contains: Services for courses, auth, grants, audit, sessions
- Key files:
  - `resource-service.ts` - Factory generating list/get/create/update for any model
  - `course-service.ts` - Courses (reference example for all other resources)
  - `auth-service.ts` - Sign-in and account lifecycle
  - `grant-service.ts` - Load user's permission grants
  - `audit-service.ts` - Record audit events
  - `session-service.ts` - Look up actor by session token

**`tests/`:**
- Purpose: Unit and integration tests
- Contains: Vitest test files, test fixtures
- Key files:
  - `*.test.ts` - Tests for services, permissions, auth

## Key File Locations

**Entry Points:**
- `src/app/(auth)/signin/page.tsx` - Sign-in page
- `src/app/page.tsx` - Root (redirects authenticated to /staff/courses, anonymous to /signin)
- `src/app/staff/layout.tsx` - Staff workspace shell and navigation
- `src/app/staff/courses/page.tsx` - Course list view

**Configuration:**
- `tsconfig.json` - TypeScript paths (`@/*` → `./src/*`)
- `next.config.ts` - Next.js build configuration
- `tailwind.config.ts` - Tailwind CSS customization
- `eslint.config.mjs` - Linting rules (enforces service-layer Prisma imports)
- `.env`, `.env.local` - Database URL, secrets (not committed)

**Core Logic:**
- `src/server/db.ts` - Prisma client singleton
- `src/server/permissions/with-permission.ts` - Authorization choke point
- `src/server/services/resource-service.ts` - CRUD factory
- `src/server/auth/current-actor.ts` - Session reader
- `prisma/schema.prisma` - Data model

**Testing:**
- `tests/*.test.ts` - Unit tests (course-service, lockout, auth schema)
- `vitest.config.*` - Vitest configuration (if present)
- `jest.config.*` - Jest configuration (if present, else Vitest)

## Naming Conventions

**Files:**
- Page routes: `page.tsx` (Next.js convention)
- Server actions: `actions.ts` (grouped with page or layout)
- Client components: `ComponentName.tsx` (PascalCase)
- Server components: `ServerComponentName.tsx` (default, unless "use client")
- Services: `entity-service.ts` (kebab-case with -service suffix)
- Tests: `*.test.ts` or `*.spec.ts` (Vitest convention)

**Directories:**
- Route groups: `(groupName)` - parentheses group without affecting URL
- Dynamic routes: `[paramName]` - brackets for path parameters
- Scoped features: Grouped under route prefix (e.g., `/staff/*`)
- Server code: Always under `src/server/`

**Functions:**
- Service functions: `entityOperation` (e.g., `signIn`, `courseList`)
- Hooks (client): `useEntityAction` (e.g., `useFormSubmit`)
- Factories: `createEntityFactory` (e.g., `createResourceService`)
- Utilities: `actionDescription` (e.g., `getCurrentActor`, `hasPermission`)

**Types:**
- Request/response types: `EntityName` (e.g., `SignInResult`, `CourseRow`)
- Props types: `{Component}Props` (e.g., `ResourceTableProps`)
- Config types: `{Entity}Config` (e.g., `ResourceServiceConfig`)
- Enums from schema: SCREAMING_SNAKE_CASE (from Prisma, e.g., `UserStatus.PENDING_VERIFICATION`)

## Where to Add New Code

**New Resource CRUD (e.g., Lessons, Tickets):**
1. Define Prisma model in `prisma/schema.prisma`
2. Create migration: `npm run db:migrate`
3. Add permission strings to `src/server/permissions/catalogue.ts`
4. Create service: `src/server/services/{entity}-service.ts`
   - Use `createResourceService` factory
   - Define `entityScope()` for scope resolution
5. Create page: `src/app/staff/{entity}/page.tsx`
6. Create components (or reuse primitives)
7. Add tests: `tests/{entity}-service.test.ts`

**New Feature Page:**
1. Create route: `src/app/staff/{feature}/page.tsx` (server component)
2. Add to staff navigation: Edit `src/app/staff/layout.tsx`
3. Call service within `try/catch` for error handling
4. Wrap data fetches with `withPermission` if custom logic
5. Render primitives or custom components

**New Permission:**
1. Add string to `PERMISSIONS` in `src/server/permissions/catalogue.ts`
2. Update role definitions in database (via Prisma Studio or migration)
3. Use permission string in `withPermission(permission, ...)` calls

**New Utility/Helper:**
- Shared across features: `src/lib/{utility}.ts`
- Feature-specific: Co-locate near usage (same directory or adjacent)
- Client-only (React hooks): `src/components/hooks/useHook.ts`
- Server-only: `src/server/{layer}/{utility}.ts`

**New Test:**
- Co-locate with code: `{module}.test.ts` in same directory as `{module}.ts`
- Or in `tests/` directory if it's integration-level
- Use Vitest syntax and patterns from existing tests

## Special Directories

**`prisma/migrations/`:**
- Purpose: Timestamped database schema changes
- Generated: Yes (by `prisma migrate dev`)
- Committed: Yes (required for reproducible deployments)
- Never edit manually; always use `prisma migrate` commands

**`prisma/sql/`:**
- Purpose: Hand-written SQL for constraints Prisma cannot express
- Generated: No (written by hand)
- Committed: Yes (part of schema)
- Contains: Partial unique indexes, check constraints, integrity rules

**`.next/`:**
- Purpose: Next.js build output
- Generated: Yes (by `npm run build`)
- Committed: No (in .gitignore)
- Contains: Compiled JavaScript, type information, cache

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes (by `npm install`)
- Committed: No (in .gitignore)
- Lockfile: `package-lock.json` (committed)

---

*Structure analysis: 2026-09-01*
