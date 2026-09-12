# Testing Patterns

**Analysis Date:** 2026-09-01

## Test Framework

**Runner:**
- Vitest 4.1.11
- Node.js environment (not browser/jsdom)
- Config: `vitest.config.mts`

**Assertion Library:**
- Vitest's built-in expect (chai-based)
- No additional assertion libraries

**Run Commands:**
```bash
npm test              # Run all tests once
npm test -- --watch  # Watch mode (if configured)
npx vitest run       # Explicit run mode
```

**Configuration:**
```typescript
// vitest.config.mts
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
```

## Test File Organization

**Location:**
- All tests in `tests/` directory (co-located pattern rejected)
- Mirror the module structure when meaningful, but not required

**Naming:**
- `*.test.ts` suffix (e.g., `course-service.test.ts`, `lockout.test.ts`)
- One test file per module being tested

**Structure:**
```
tests/
├── course-service.test.ts
├── lockout.test.ts
├── password.test.ts
├── permissions.test.ts
├── resource-service.test.ts
├── schema-auth.test.ts
├── scope.test.ts
├── structure.test.ts
├── with-permission.test.ts
└── boundary.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, it } from "vitest";

describe("functionName", () => {
  it("does something specific", () => {
    expect(result).toBe(expected);
  });

  it("handles edge case X", () => {
    expect(result).toBe(expected);
  });
});
```

**Patterns:**
- `describe()` wraps related tests for one function/class
- `it()` is one assertion block with one focused behavior
- Test names are in lowercase, start with a verb: "does", "returns", "throws", "handles", "rejects"
- One test per behavior, not one test per code path

**Multi-case Tests:**
```typescript
describe("projectStructure", () => {
  const REQUIRED_DIRECTORIES = ["src/app", "src/server/services", ...];
  
  it.each(REQUIRED_DIRECTORIES)("has %s", (dir) => {
    expect(existsSync(path.resolve(process.cwd(), dir))).toBe(true);
  });
});
```

## Async Testing

**Pattern:**
```typescript
it("runs the handler when a grant matches", async () => {
  const { withPermission } = harness({ grants: [activeGrant("courses.edit")] });
  const handler = vi.fn(async () => "done");

  const action = withPermission("courses.edit", () => ({ courseIds: ["c1"] }))(handler);

  await expect(action({ courseId: "c1" })).resolves.toBe("done");
  expect(handler).toHaveBeenCalledOnce();
});
```

**Error Testing:**
```typescript
it("rejects an anonymous caller without running the handler", async () => {
  const { withPermission } = harness({ grants: [], actor: null });
  const handler = vi.fn(async () => "done");

  const action = withPermission("courses.edit", () => ({}))(handler);

  await expect(action({})).rejects.toBeInstanceOf(AuthenticationError);
  expect(handler).not.toHaveBeenCalled();
});
```

**Key Methods:**
- `expect(...).resolves.toBe()` — assert resolved value
- `expect(...).rejects.toBeInstanceOf(ErrorClass)` — assert error thrown
- `toHaveBeenCalledOnce()`, `toHaveBeenCalled()`, `not.toHaveBeenCalled()`

## Mocking

**Framework:** Vitest's `vi` module

**Patterns:**

**Function Mocking:**
```typescript
import { vi } from "vitest";

const handler = vi.fn(async () => "done");
await handler();
expect(handler).toHaveBeenCalledOnce();
```

**Dependency Injection (Harness Pattern):**
Most tests use a "harness" function that injects dependencies instead of mocking:

```typescript
type Harness = {
  grants: RawGrant[];
  actor?: { userId: string } | null;
};

function harness({ grants, actor = { userId: "user-1" } }: Harness) {
  const audits: AuditEntry[] = [];
  const withPermission = createWithPermission({
    getActor: async () => actor,
    loadGrants: async () => grants,
    audit: async (entry) => {
      audits.push(entry);
    },
    now: () => NOW,
  });
  return { withPermission, audits };
}
```

This approach:
- Avoids mocking library dependencies
- Makes test setup explicit and readable
- Allows assertion on side effects (e.g., `audits` array)

**What to Mock:**
- Event handlers: `vi.fn()` for `onClick`, `onChange`
- Module imports when testing in isolation

**What NOT to Mock:**
- Database calls (use real database or seed fixtures)
- External services (use dependency injection instead)
- Internal service functions (import the real implementation)

## Fixtures and Factories

**Test Data:**
```typescript
const NOW = new Date("2026-09-01T12:00:00Z");

const activeGrant = (
  permission: string,
  scopeType: RawGrant["scopeType"] = "GLOBAL",
  scopeId: string | null = null,
): RawGrant => ({
  permission: permission as RawGrant["permission"],
  scopeType,
  scopeId,
  active: true,
  revokedAt: null,
  startsAt: null,
  endsAt: null,
});
```

**Location:**
- Fixture functions defined at the top of test files (not in separate files)
- Factory functions return test data with sensible defaults
- Use spread operators to override defaults: `{ ...activeGrant("courses.edit"), revokedAt: now }`

**Pattern:**
```typescript
const state = nextFailureState(MAX_FAILED_ATTEMPTS - 1, NOW);
expect(state.failedLoginAttempts).toBe(MAX_FAILED_ATTEMPTS);
expect(state.lockedUntil).toEqual(
  new Date(NOW.getTime() + LOCKOUT_MINUTES * 60_000),
);
```

## Assertions

**Common Patterns:**
```typescript
// Equality
expect(result).toBe(expected);              // Strict equality (===)
expect(obj).toEqual(expected);              // Deep equality

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();

// Partial object matching
expect(object).toMatchObject({
  action: "authorization.denied",
  outcome: "DENIED",
  actorId: "user-1",
});

// Collections
expect(array).toHaveLength(1);
expect(array).toContain("value");
expect(array).toHaveBeenCalledOnce();

// Errors
expect(() => fn()).toThrow(ErrorClass);
expect(fn).toHaveBeenCalledWith(arg1, arg2);
expect(fn).not.toHaveBeenCalled();
```

## Coverage

**Requirements:** None enforced

Coverage measurement is available but not required. Tests focus on behavior correctness rather than line coverage targets.

## Test Types

**Unit Tests:**
- Test single functions in isolation
- Examples: `lockout.test.ts` (pure functions), `password.test.ts` (crypto utilities)
- Fast, deterministic, no dependencies

**Integration Tests:**
- Test how multiple modules work together
- Examples: `with-permission.test.ts` (tests the full authorization stack)
- Use harness pattern for dependency injection

**Structural Tests:**
- Validate project organization
- Example: `structure.test.ts` checks required directories exist
- Example: `schema-auth.test.ts` validates database schema

**Boundary Tests:**
- Test the interface between app and server layers
- Example: `boundary.test.ts` validates that imports don't cross architectural boundaries
- Use ESLint rules alongside tests to enforce at lint-time

## Setup and Teardown

**Pattern:**
No global setup/teardown files. Each test is self-contained via the harness pattern.

If shared setup becomes needed, use `beforeEach()`:
```typescript
describe("withPermission", () => {
  const NOW = new Date("2026-09-01T12:00:00Z");
  
  it("test 1", () => {
    // NOW is available
  });
});
```

## Special Testing Patterns

**Permission Testing:**
Test three states: allowed, denied, and authentication failure:

```typescript
it("runs the handler when a grant matches", async () => {
  // ALLOWED case
  const { withPermission } = harness({ grants: [activeGrant("courses.edit")] });
  await expect(action()).resolves.toBeDefined();
});

it("denies by default when the user holds no grants", async () => {
  // DENIED case
  const { withPermission } = harness({ grants: [] });
  await expect(action()).rejects.toBeInstanceOf(AuthorizationError);
});

it("rejects an anonymous caller without running the handler", async () => {
  // UNAUTHENTICATED case
  const { withPermission } = harness({ grants: [], actor: null });
  await expect(action()).rejects.toBeInstanceOf(AuthenticationError);
});
```

**Audit Testing:**
Verify that important operations are audited:

```typescript
it("audits a denial with permission, actor, and outcome", async () => {
  const { withPermission, audits } = harness({ grants: [] });

  const action = withPermission("payments.confirm", () => ({}))(handler);
  await expect(action({})).rejects.toBeInstanceOf(AuthorizationError);

  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: "authorization.denied",
    outcome: "DENIED",
    actorId: "user-1",
  });
});
```

**Time-Dependent Testing:**
Use a fixed `NOW` constant for reproducible tests:

```typescript
const NOW = new Date("2026-09-01T12:00:00Z");

describe("isLockedOut", () => {
  it("is false once the lockout has passed", () => {
    expect(isLockedOut(
      { lockedUntil: new Date("2026-09-01T11:55:00Z") },
      NOW
    )).toBe(false);
  });
});
```

## Running Tests

**All Tests:**
```bash
npm test
```

**Watch Mode (if running locally):**
```bash
npx vitest
```

**Specific File:**
```bash
npx vitest tests/lockout.test.ts
```

**Filter by Name:**
```bash
npx vitest -t "isLockedOut"
```

---

*Testing analysis: 2026-09-01*
