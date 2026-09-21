<!-- refreshed: 2026-09-01 -->
# Architecture

**Analysis Date:** 2026-09-01

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                       Next.js App Router (Pages)                     │
│  src/app/(auth)/signin  │  src/app/staff/*  │  src/app/page.tsx     │
└──────────┬──────────────────────────────────────────────────┬────────┘
           │                                                  │
           ▼                                                  ▼
┌──────────────────────────────┐    ┌─────────────────────────────────┐
│  Client Components (React)   │    │  Server Components & Actions    │
│  src/components/primitives   │    │  src/app/**/page.tsx            │
│  - ResourceTable             │    │  src/app/**/actions.ts          │
│  - ResourceForm              │    │  src/app/**/SignInForm.tsx      │
│  - DetailLayout              │    │                                 │
└──────────┬───────────────────┘    └────────────┬────────────────────┘
           │                                     │
           │                    ┌────────────────┘
           │                    │
           ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Authorization Choke Point (Single)                  │
│             src/server/permissions/with-permission.ts              │
│                                                                      │
│  - Authentication check (actor from session)                       │
│  - Permission resolution (grant matching)                          │
│  - Scope validation (resource-scoped access)                       │
│  - Audit recording on denial                                       │
└────────────┬──────────────────────────────────────────────┬────────┘
             │                                              │
             ▼                                              ▼
┌────────────────────────────────────┐  ┌──────────────────────────────┐
│   Service Layer (Business Logic)   │  │  Auth Layer                  │
│  src/server/services/             │  │  src/server/auth/            │
│  - resource-service.ts (factory)  │  │  - current-actor.ts          │
│  - course-service.ts              │  │  - session-service.ts        │
│  - auth-service.ts                │  │  - lockout.ts                │
│  - grant-service.ts               │  │  - password.ts               │
│  - audit-service.ts               │  │                              │
│  - session-service.ts             │  │                              │
└────────────┬─────────────────────┘  └──────────┬───────────────────┘
             │                                   │
             └───────────────┬───────────────────┘
                             │
                             ▼
                ┌────────────────────────────┐
                │   Prisma ORM Client        │
                │  src/server/db.ts          │
                │  (Singleton pattern)       │
                └────────────┬───────────────┘
                             │
                             ▼
                ┌────────────────────────────┐
                │   PostgreSQL Database      │
                │  prisma/schema.prisma      │
                └────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| App Router Pages | Route handling, request dispatch, redirect logic | `src/app/(auth)/signin/page.tsx`, `src/app/staff/courses/page.tsx` |
| Server Actions | Handle form submissions, wrap with authorization | `src/app/(auth)/signin/actions.ts` |
| Server Components | Fetch data server-side, render with current context | `src/app/staff/layout.tsx`, `src/app/staff/courses/page.tsx` |
| Client Components | Interactive UI, form submission, state management | `src/components/primitives/ResourceTable.tsx` |
| withPermission | Authorization factory, grant matching, audit | `src/server/permissions/with-permission.ts` |
| Services | CRUD operations, domain logic, audit recording | `src/server/services/*.ts` |
| Auth Services | Session management, password verification | `src/server/auth/*.ts` |
| Prisma Client | ORM, database queries | `src/server/db.ts` |

## Pattern Overview

**Overall:** Layered architecture with authorization as a cross-cutting concern

**Key Characteristics:**
- **Single authorization choke point** - Every protected operation routes through `withPermission`, enforcing consistent permission checks
- **Factory-based services** - `createResourceService` generates CRUD operations with built-in authorization and audit
- **Permission-aware scoping** - Access is scoped by GLOBAL, PROGRAMME, COURSE, or COHORT
- **Database sessions not JWT** - Enables selective revocation and session invalidation (IAM-03)
- **Audit-first design** - Every authorization denial is recorded; every state change is audited
- **Server-side rendering** - Next.js server components fetch data with authorization context built-in

## Layers

**Presentation Layer:**
- Purpose: Render UI, handle user interaction
- Location: `src/app/`, `src/components/primitives/`
- Contains: Next.js pages, server components, client components, server actions
- Depends on: Services (via `withPermission`), current actor
- Used by: Browser clients

**Permission Layer:**
- Purpose: Enforce authorization, record audit trails, gate access to all protected operations
- Location: `src/server/permissions/`
- Contains: `withPermission` factory, permission catalogue, scope resolution, grant validation
- Depends on: Auth services (to load grants), audit services (to record denials)
- Used by: All service functions, server actions

**Service Layer:**
- Purpose: Implement domain logic, manage resource state, record operation audit
- Location: `src/server/services/`
- Contains: Resource CRUD services, business logic for auth/sessions/grants/audit
- Depends on: Prisma ORM, permission layer
- Used by: Pages, server actions, server components

**Auth Layer:**
- Purpose: Manage session lifecycle, password hashing, login lockout
- Location: `src/server/auth/`
- Contains: Session creation/validation, password verification, failure tracking
- Depends on: Prisma ORM
- Used by: Current-actor resolution, sign-in flow

**Database Layer:**
- Purpose: Provide ORM abstraction, manage database connection
- Location: `src/server/db.ts`
- Contains: Prisma client singleton
- Depends on: PostgreSQL database
- Used by: All service functions

## Data Flow

### Primary Request Path: Authenticated Page Load

1. Browser requests `/staff/courses` (`src/app/staff/courses/page.tsx:1`)
2. Server component calls `getCurrentActor()` → reads session cookie, fetches session record (`src/server/auth/current-actor.ts`)
3. If actor found, page calls `courseService.list({})` (`src/app/staff/courses/page.tsx:10-15`)
4. Service is wrapped by `withPermission("courses.view", ...)` (`src/server/services/course-service.ts:20-30`)
5. Authorization checks:
   - Confirms actor exists (else throws `AuthenticationError`)
   - Loads actor's grants from database (`src/server/services/grant-service.ts`)
   - Filters grants to active window (startsAt/endsAt)
   - Matches against permission catalogue and resource scope (`src/server/permissions/scope.ts`)
   - If denied, records audit event and throws `AuthorizationError`
6. If allowed, service fetches records via Prisma (`src/server/services/resource-service.ts:71`)
7. Service records success audit event (`src/server/services/audit-service.ts`)
8. Page renders `CoursesTable` with rows

### Authentication Flow: Sign-In

1. User navigates to `/signin`
2. Form submitted via server action `signInAction` (`src/app/(auth)/signin/actions.ts`)
3. Action calls `signIn(email, password)` (`src/server/services/auth-service.ts:22-30`)
4. Service:
   - Looks up user by lowercase email
   - Verifies password hash
   - Checks lockout state (failedLoginAttempts, lockedUntil) (`src/server/auth/lockout.ts`)
   - On success: Creates session record with TTL, returns token
   - On failure: Updates failedLoginAttempts, sets lockedUntil if threshold exceeded
5. Action sets session cookie with returned token
6. Browser redirected to `/staff/courses` (or landing page)

**State Management:**
- Session state: Stored in PostgreSQL `Session` table with TTL-based cleanup
- User state: Tracked via `User.failedLoginAttempts`, `User.lockedUntil`
- Authorization state: Computed fresh on each request from `Assignment` grants
- Audit state: Write-only append to `AuditEvent` table

## Key Abstractions

**withPermission (Authorization Factory):**
- Purpose: Gate every protected operation with consistent permission checks and audit
- Location: `src/server/permissions/with-permission.ts:98-154`
- Pattern: Higher-order function that wraps a handler with authorization middleware
- Usage: `withPermission<TInput>(permission, resolveScope)(handler)`
  - `permission` is a string from the catalogue (e.g., "courses.view")
  - `resolveScope` maps input to the resource being accessed
  - `handler` executes only if authorization succeeds
- Examples: `src/server/services/course-service.ts:20-30`, `src/app/(auth)/signin/actions.ts`

**ResourceService (CRUD Factory):**
- Purpose: Generate list, get, create, update operations with baked-in authorization and audit
- Location: `src/server/services/resource-service.ts:62-120`
- Pattern: Factory function taking config (name, permissions, delegate, scope resolver)
- Examples: `src/server/services/course-service.ts` uses this for `courseService.list/get/create/update`
- Behaviors:
  - `list` requires GLOBAL grant (no implicit filtering by scope)
  - `get` requires matching scope grant
  - `create` requires global permission
  - `update` requires matching scope, records before/after for audit

**Grant & Scope Matching:**
- Purpose: Determine if a user's assigned grants satisfy a required permission on a resource
- Location: `src/server/permissions/scope.ts`
- Pattern: Permission is checked against active Assignment records, filtered by scopeType and scopeId
- Scope types: GLOBAL (no scopeId), PROGRAMME, COURSE, COHORT
- Example: User with `courseId` scope can only access that course; global grant reaches all

**Session Management:**
- Purpose: Track authenticated user across requests, enable revocation
- Location: `src/server/services/session-service.ts`, `src/server/auth/lockout.ts`
- Pattern: Database sessions with expiry, stored in `Session` table
- TTL: Configurable via `SESSION_TTL_DAYS` (default 30 days)
- Revocation: Set `revokedAt` timestamp on Session record

## Entry Points

**Web Requests (Next.js App Router):**
- Location: `src/app/` (all `.tsx` files)
- Triggers: HTTP requests to `/signin`, `/staff/courses`, etc.
- Responsibilities: Route dispatch, authorization via `getCurrentActor()`, render with context

**Server Actions (Form Submissions):**
- Location: `src/app/**/actions.ts` (marked with `"use server"`)
- Triggers: Form submission from client components
- Responsibilities: Validate input, call services, record results, return state to client
- Examples: `src/app/(auth)/signin/actions.ts` for sign-in

**Scheduled/Async (Future):**
- Not yet implemented; would use Job queue in schema

## Architectural Constraints

- **Threading:** Single-threaded event loop (Node.js). Database queries are async but sequential per request.
- **Global state:** Prisma client is cached on `globalThis` in development to survive hot reloads (`src/server/db.ts:15-27`). No other module-level mutable state.
- **Circular imports:** None detected. Clear dependency direction: presentation → services → auth/permissions → database.
- **Session invalidation:** Requires database lookup; cannot be done via client-side token revocation alone.
- **Scope isolation:** A user cannot enumerate resources outside their scope. `list` with no scope requires GLOBAL grant (deny-by-default for scoped users).

## Anti-Patterns

### Missing Permission Checks in Route Handlers

**What happens:** A page or route handler fetches data without calling `getCurrentActor()` or wrapping with `withPermission`.

**Why it's wrong:** Silently returns data to unauthenticated or unauthorized users. The page renders a denial message, but the data was already fetched.

**Do this instead:** Always call `getCurrentActor()` or wrap the data fetch with `withPermission`. Example: `src/app/staff/courses/page.tsx:9-12`.

### Bypassing Services for Direct Prisma Calls

**What happens:** A page or action calls `prisma.course.findMany()` directly instead of via `courseService.list()`.

**Why it's wrong:** Skips authorization and audit. Only `src/server/db.ts` and files in `src/server/services/` are permitted to import `@prisma/client`.

**Do this instead:** Use the service. If no service exists for the model, create one using `createResourceService`. See `src/server/services/course-service.ts` as a template.

### Recording Audit on Authorization Denial in the Handler

**What happens:** The service records an audit event for every call, including denials.

**Why it's wrong:** The denial is already audited by `withPermission` before the handler runs. Double-recording is noise.

**Do this instead:** Audit only the business action (create, update, archive). `withPermission` handles denials. See `src/server/services/resource-service.ts:82-91`.

## Error Handling

**Strategy:** Explicit error types thrown at choke points; presentation layer catches and renders.

**Patterns:**
- `AuthenticationError` - Thrown by `withPermission` when no session exists. Message: "Sign in to continue."
- `AuthorizationError` - Thrown by `withPermission` when grant matching fails. Message does not reveal resource existence (RBAC-06).
- Both are caught by pages and displayed to user (`src/app/staff/courses/page.tsx:24-32`)
- Other errors (database, validation) propagate as server errors, returning 5xx to browser

## Cross-Cutting Concerns

**Logging:** Console logging in development only (via `prisma.log` in `src/server/db.ts:20-22`). No application logger configured.

**Validation:** Input validation is minimal; database schema and Prisma types enforce constraints. Form validation is client-side (HTML5) before submission.

**Authentication:** Database sessions via cookie. Session cookie is HttpOnly, Secure, SameSite. Reading requires `await cookies()` (async in Next.js 16).

---

*Architecture analysis: 2026-09-01*
