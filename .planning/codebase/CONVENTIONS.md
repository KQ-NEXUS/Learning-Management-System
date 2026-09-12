# Coding Conventions

**Analysis Date:** 2026-09-01

## Naming Patterns

**Files:**
- TypeScript files: `lowercase-with-dashes.ts` (e.g., `auth-service.ts`, `with-permission.ts`)
- React components: `PascalCase.tsx` (e.g., `ResourceTable.tsx`, `ConfirmModal.tsx`)
- Test files: `*.test.ts` pattern (e.g., `course-service.test.ts`, `lockout.test.ts`)
- Server actions: `actions.ts` in route directories (e.g., `src/app/(auth)/signin/actions.ts`)

**Functions:**
- camelCase for all function names: `hashPassword()`, `signIn()`, `createResourceService()`
- Server actions suffixed with "Action": `signInAction()`, `signOutAction()`
- Helper/utility functions are lowercase with dash-separated words when exported: `getRowKey()`, `verifyPassword()`
- Factory functions use "create" prefix: `createWithPermission()`, `createResourceService()`

**Types and Interfaces:**
- PascalCase for all types, interfaces, and enums: `SignInResult`, `ResourceScope`, `AuthorizationError`
- Type aliases use PascalCase: `Actor`, `RawGrant`, `AuditEntry`
- Discriminated union types use a `status` or `ok` field: `{ ok: true; ... } | { ok: false; ... }`

**Variables and Constants:**
- camelCase for local variables: `const result = await signIn(...)`
- UPPER_CASE with underscores for module-level constants: `SESSION_TTL_DAYS`, `MAX_FAILED_ATTEMPTS`, `LOCKOUT_MINUTES`
- UPPER_CASE for Tailwind class constants: `const CELL = "px-3 py-2 align-middle"`, `const BTN = "border border-zinc-300..."`
- const for immutable collections: `const NAV = [...] as const`

## Code Style

**Formatting:**
- No automatic formatter configured (no Prettier)
- ESLint enforces style rules via `eslint.config.mjs`
- Target: ES2017 (defined in `tsconfig.json`)
- Module format: ESNext
- TypeScript strict mode enabled

**Linting:**
- Framework: ESLint 9.x (flat config format)
- Configuration: `eslint.config.mjs` with Next.js rules
- Extends: `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`

**Key ESLint Rules:**
- Prisma imports restricted to `src/server/services/` and `src/server/db.ts`
- All other code must call a service instead (see `eslint.config.mjs` lines 29-54)
- Violations result in error: "Data access is confined to src/server/services/. Call a service instead"

## Import Organization

**Order:**
1. Node.js built-in modules (e.g., `import { randomBytes } from "node:crypto"`)
2. External packages (e.g., `import { prisma } from "@prisma/client"`)
3. Relative and path-aliased imports (e.g., `import { signIn } from "@/server/services/auth-service"`)
4. Type imports (grouped separately with `import type`)

**Path Aliases:**
- `@/*` resolves to `src/*` (configured in `tsconfig.json`)
- Use `@/` for all internal imports: `@/server/services`, `@/components`, `@/lib`
- Never use relative paths (`../../../`) in src files

**Example Import Block:**
```typescript
// Node first
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

// External packages
import { prisma } from "@/server/db";

// Internal imports
import { verifyPassword } from "@/server/auth/password";
import { recordAudit } from "@/server/services/audit-service";

// Type imports grouped at end
import type { Permission } from "@/server/permissions/catalogue";
import type { ResourceScope } from "@/server/permissions/scope";
```

## Error Handling

**Patterns:**
- Define custom error classes extending `Error` with `.name` set
- Use discriminated union types (`{ ok: true } | { ok: false }`) for operation results
- Custom errors include context fields: `AuthorizationError` stores `permission` property
- Return false rather than throwing on validation failures: `verifyPassword()` returns boolean
- Secure errors: Deny messages never reveal whether a resource exists (see `AuthorizationError` message)

**Custom Error Classes:**
```typescript
export class AuthenticationError extends Error {
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  readonly permission: Permission;
  
  constructor(permission: Permission) {
    super("You do not have access to perform this action.");
    this.name = "AuthorizationError";
    this.permission = permission;
  }
}
```

**Result Discriminators:**
```typescript
export type SignInResult =
  | { ok: true; token: string; expires: Date }
  | { ok: false; reason: "INVALID" | "LOCKED" };
```

## Logging

**Framework:** No logger library — use `console` directly where needed

**Patterns:**
- Errors logged at decision points (permission denials, validation failures)
- Audit entries replace most logging (see `recordAudit()` usage)
- No sensitive data in logs (passwords, tokens, emails)

## Comments

**When to Comment:**
- Explain WHY, not WHAT (code shows what, comments show reasoning)
- Reference requirements: "PRD RBAC-06 requires selective revocation"
- Document security decisions: "Deliberately identical whether or not any record exists"
- Document performance decisions: "Stored format travels with hash for parameter updates"
- Document breaking behaviors: "There is no delete. PRD CAT-08 requires archiving"

**JSDoc/TSDoc:**
```typescript
/**
 * Revokes one session. IAM-03.
 * 
 * Creates an audit record and marks the session token as revoked without
 * deleting the row, preserving historical enrolments.
 */
export async function signOut(token: string): Promise<void> {
  ...
}
```

**Block Comments:**
- Use `/**` style for all public function documentation
- Reference spec sections (e.g., "PRD RBAC-06", "IAM-03")
- Explain non-obvious parameter behavior
- Document exceptions and edge cases

## Function Design

**Size:** 
- Prefer small functions (30-50 lines typical)
- Extract loops and conditionals into separate named functions
- One responsibility per function

**Parameters:**
- Use object parameters for functions with 3+ parameters
- Typed parameter objects with JSDoc explaining each field
- Optional parameters documented with `?`

**Return Values:**
- Always type the return explicitly
- Return `Promise<T>` for async functions
- Use discriminated unions for complex results
- Void return for side-effect only functions

**Example Function:**
```typescript
/**
 * Sign-in and session lifecycle.
 * 
 * IAM-03 requires selective and global revocation — a JWT cannot be withdrawn
 * before it expires. Database sessions allow this.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<SignInResult> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, passwordHash: true, status: true },
  });

  if (!user || !user.passwordHash || user.status !== "ACTIVE") {
    return { ok: false, reason: "INVALID" };
  }

  // ... rest of implementation
  return { ok: true, token, expires };
}
```

## Module Design

**Exports:**
- Named exports only (no default exports except for React components and Next.js pages)
- Export types alongside implementation
- Group related exports (types first, then implementations)

**Barrel Files:**
- Use `index.ts` to re-export public APIs
- Example: `src/components/primitives/index.ts` exports all component types and components

**Service Layer Pattern:**
```typescript
// src/server/services/auth-service.ts
export type SignInResult = { ok: true; ... } | { ok: false; ... };

export async function signIn(email: string, password: string): Promise<SignInResult> {
  // implementation
}

export async function signOut(token: string): Promise<void> {
  // implementation
}
```

## React Component Conventions

**Component Naming:**
- PascalCase for all components
- Descriptive names: `ResourceTable`, `StatusPill`, `ConfirmModal`
- File name matches component name exactly

**Component Props:**
- Define `Props` type at component level
- Use interface for component props
- Full JSDoc documentation for each prop

**Server vs Client Components:**
- Server components by default (no "use client")
- Add `"use client"` directive only when needed: `ResourceTable` uses it for interactivity
- Server actions in `actions.ts` files, marked with `"use server"`

**Props Pattern:**
```typescript
export type ResourceTableProps<T> = {
  /** Describes the collection, e.g. "cohorts". Used in status messages. */
  noun: string;
  title?: string;
  columns: Column<T>[];
  state: ResourceTableState<T>;
  getRowKey: (row: T) => string;
  // ... more props documented
};

export function ResourceTable<T>({
  noun,
  title,
  // ... destructured props
}: ResourceTableProps<T>) {
  // implementation
}
```

**Discriminated Union States:**
```typescript
export type ResourceTableState<T> =
  | { status: "loading" }
  | { status: "ready"; rows: T[] }
  | { status: "empty"; activeFilterCount?: number }
  | { status: "denied"; permission?: string }
  | { status: "error"; message?: string; trace?: string };
```

## Accessibility

**Requirements:**
- All interactive elements must have accessible names: `aria-label`, `aria-labelled-by`
- Images and icons must have alt text or `aria-hidden="true"`
- Forms use semantic HTML: `<label>`, `<button type="submit">`
- Tables use `<caption>` and proper `scope` attributes
- Status messages use `aria-live="polite"`
- Disabled elements use `aria-disabled` when not true `disabled`

**Example:**
```typescript
<input
  type="checkbox"
  aria-label="Select all rows"
  checked={checked}
  onChange={(e) => onChange(e.target.checked)}
/>
```

## TypeScript Patterns

**Strict Mode:**
- `strict: true` enabled in `tsconfig.json`
- No implicit any
- No implicit this
- Strict null checks required

**Generic Type Parameters:**
- Use descriptive names: `<T>` for a generic resource, `<TInput, TOutput>` for function transforms
- Constrain generics when needed: `<T extends { id: string }>`

**Type Guards:**
- Use custom type guards for discriminated unions
- Example: `if (!user || !user.passwordHash) return { ok: false }`

---

*Convention analysis: 2026-09-01*
