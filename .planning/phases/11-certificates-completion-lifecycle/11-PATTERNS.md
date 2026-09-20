# Phase 11: Certificates & Completion Lifecycle - Pattern Map

**Mapped:** 2026-09-16
**Files analyzed:** 22 (new + modified, per RESEARCH.md's Recommended Project Structure and Test Map)
**Analogs found:** 20 / 22

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/server/services/certificate-issuance-service.ts` | service (reactive hook / composition wrapper) | event-driven | `src/server/services/lesson-progress-service.ts` (DI-slot wrapping pattern) + `src/server/services/completion-service.ts` (`applyVerdict` state table) | role-match (no prior "wrap a DI dependency" file has this exact shape, but the seam is identical) |
| `src/server/services/certificate-service.ts` | service (CRUD + revoke/reissue mutation) | CRUD | `src/server/services/grade-override-service.ts` (audit-first correction mutation) + `src/server/services/resource-service.ts` (CRUD factory) | exact (revoke/reissue is structurally a `GradeOverride`-style compare-and-set correction with mandatory reason) |
| `src/server/services/certificate-template-service.ts` | service (resource CRUD) | CRUD | `src/server/services/resource-service.ts`'s `createResourceService` consumers (e.g. `course-service.ts`/`cohort-service.ts` shape) | exact |
| `src/server/services/certificate-verification-service.ts` | service (pure, unauthenticated read) | request-response | `src/server/services/readiness-service.ts` (pure evaluator, no auth import) | role-match |
| `src/server/services/certificate-pdf-renderer.ts` | utility (pure transform) | transform | `src/server/services/completion-rule.ts` (pure module, no imports, versioned-schema parse) — pattern only, no PDF analog exists | role-match |
| `src/server/services/certificate-template-layout.ts` | utility (pure JSON-schema parser) | transform | `src/server/services/completion-rule.ts` (`parseCompletionRule`, versioned JSON blob parsed by one pure function) | exact |
| `src/server/services/grade-override-service.ts` (MODIFIED — add hook) | service | event-driven | itself, extending its own existing `GradeOverrideDeps` injection shape | exact (self-modification, extend existing DI slot) |
| `src/server/services/attendance-service.ts` (MODIFIED — swap default dep) | service | event-driven | `src/server/services/lesson-progress-service.ts`'s identical `recalculateCompletionDep` composition-root parameter | exact |
| `src/server/services/lesson-progress-service.ts` (MODIFIED — swap default dep) | service | event-driven | `src/server/services/attendance-service.ts`'s identical pattern (they mirror each other) | exact |
| `src/server/services/enrolment-transitions.ts` (MODIFIED — `VALID_TRANSITIONS.COMPLETED`) | utility (state-machine table) | transform | itself — one-line table edit, `ACTIVE`'s existing array is the template | exact |
| `src/server/services/enrolment-dashboard-service.ts` (MODIFIED — populate `certificate` column) | service (read model) | CRUD | itself — `results`/`assessmentObligations` columns already show the "populate a previously-deferred column" pattern | exact |
| `src/server/services/storage-service.ts` (MODIFIED — add certificate key builders + direct PUT) | service (storage) | file-I/O | itself — `buildSubmissionStorageKey`/`buildStagedSubmissionStorageKey`/`finalSubmissionKeyFor` sibling-function trio | exact |
| `src/app/verify/[verificationRef]/page.tsx` | component (public SSR page) | request-response | `src/app/(public)/layout.tsx` (existing public route group) — new sibling layout needed, not nested under this one | role-match (deliberately divergent per Anti-Pattern) |
| `src/app/staff/certificates/page.tsx` | route (staff SSR queue page) | request-response | `src/app/staff/cohorts/[id]/grading/[assessmentId]/page.tsx` | exact |
| `src/app/staff/certificates/CertificateQueueTable.tsx` | component (client table + batch action) | request-response | `src/app/staff/cohorts/[id]/grading/[assessmentId]/GradingQueueTable.tsx` | exact |
| `src/app/staff/certificates/certificate-actions.ts` | route (server action) | request-response | `src/app/staff/cohorts/[id]/grading-actions.ts` | exact |
| `src/app/staff/certificates/templates/` (editor pages) | component (client canvas UI) | request-response | none — no comparable drag/position canvas exists in this codebase | no analog |
| `src/app/api/certificates/[id]/download/route.ts` | route (authenticated download) | file-I/O | `src/app/api/lesson-resources/[id]/download/route.ts` | exact |
| `prisma/schema.prisma` (MODIFIED — `certificateIssuanceMode`, `CertificateTemplate`, `certificateTemplateId`) | model | CRUD | existing `Certificate`/`CompletionRecord` models + `Course.certificateEnabled`/`Programme.certificateEnabled` fields | exact |
| `prisma/migrations/<new>/migration.sql` (partial unique index trailer) | migration | CRUD | `prisma/migrations/20260901115332_init/migration.sql` lines 1216-1218 (`enrolment_one_active_per_learner_cohort`) | exact |
| `tests/certificate-issuance-service.test.ts`, `tests/certificate-verification.test.ts`, `tests/certificate-revocation.test.ts`, `tests/certificate-template-service.test.ts` | test | event-driven / request-response | `tests/attendance-service.test.ts` / `tests/lesson-progress-service.test.ts` (fake-tx DI test style, not read this session — same file-naming convention as the service they test) | role-match |
| `tests/certificate-download.integration.test.ts`, `tests/certificate-concurrency.integration.test.ts` | test (integration) | file-I/O / event-driven | Phase 6/10's `*.integration.test.ts` files (real Postgres + real MinIO, per RESEARCH.md's Validation Architecture) | role-match |

## Pattern Assignments

### `src/server/services/certificate-issuance-service.ts` (service, event-driven)

**Analogs:** `src/server/services/lesson-progress-service.ts` (composition-root DI wrapping) + `src/server/services/completion-service.ts` (state table this hook reacts to) + `src/server/services/checkout-webhook-system-service.ts` (`*AsSystem` actor pattern)

**The exact seam to wrap** (`src/server/services/lesson-progress-service.ts` lines 236-250, the injected dependency this new service's function replaces at the composition root):
```typescript
export type LessonProgressServiceDeps = {
  store: LessonProgressStore;
  loadLearnerPath: (actor: Actor, enrolmentId: string) => Promise<LearnerPath | null>;
  audit: Audit;
  writeEvent: typeof writeDomainEvent;
  runInTransaction: <R>(fn: (tx: LessonProgressTxClient) => Promise<R>) => Promise<R>;
  recalculateCompletion: (
    tx: CompletionServiceTxClient,
    args: { enrolmentId: string; now: Date },
  ) => Promise<CompletionRecalculationResult>;
  enrolmentScope: (enrolmentId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  now?: () => Date;
};
```

**The composition-root default-parameter swap point** (lines 774-796 — this is where `recalculateCompletionAndIssue` replaces the bare `recalculateCompletion` import, per RESEARCH.md Pattern 1):
```typescript
export function createPrismaBackedLessonProgressService(
  client: AnyPrisma,
  withPermission: WithPermission,
  audit: Audit = liveAudit,
  recalculateCompletionDep: LessonProgressServiceDeps["recalculateCompletion"] = recalculateCompletion,
  loadLearnerPathDep: LessonProgressServiceDeps["loadLearnerPath"] = liveLoadLearnerPath,
) {
  return createLessonProgressService({
    store: { /* ... */ },
    loadLearnerPath: loadLearnerPathDep,
    audit,
    writeEvent: writeDomainEvent,
    runInTransaction: (fn) => client.$transaction((tx: unknown) => fn(tx as LessonProgressTxClient)),
    recalculateCompletion: recalculateCompletionDep,
    enrolmentScope: enrolmentCohortScope,
    withPermission,
  });
}

const built = createPrismaBackedLessonProgressService(prisma, liveWithPermission);
```
`attendance-service.ts` lines 751/803 have the identical shape (`recalculateCompletionDep: AttendanceServiceDeps["recalculateCompletion"] = recalculateCompletion`) — both composition roots need the same one-line default swapped from `recalculateCompletion` to the new `recalculateCompletionAndIssue` wrapper. **Do not modify either service's internal business logic** — only the default parameter at the bottom of each file changes.

**The result shape this hook reads** (`src/server/services/completion-service.ts` lines 167-176, 268-315 — `applyVerdict`'s state table `reactToCompletionResults` branches on):
```typescript
export type CompletionScopeResult = {
  scope: "COURSE" | "PROGRAMME";
  courseId: string | null;
  verdict: CompletionVerdict;
  action: "created" | "superseded" | "unchanged";
};

export type CompletionRecalculationResult =
  | { kind: "not-evaluable"; reason: "unpinned" }
  | { kind: "evaluated"; results: CompletionScopeResult[] };
```
`action: "created"` → issue-or-queue (D-03/D-04 branch on `Course.certificateIssuanceMode`/`Programme.certificateIssuanceMode`). `action: "superseded"` → CRD-06 attendance/lesson half: set `Certificate.reviewFlaggedAt`, revert `Enrolment.status` to `ACTIVE` (D-06). `action: "unchanged"` → no-op, same idempotency discipline `applyVerdict` itself uses (`open` check on line 286).

**System-actor write pattern to copy** (`src/server/services/checkout-webhook-system-service.ts` lines 91, 845-859 — the exact `actorId`/`actorType` stamp for `issueCertificateAsSystem`'s own audit/domain-event calls):
```typescript
export const SYSTEM_ACTOR_TYPE = "SYSTEM";
// ...
await deps.audit({
  actorId: null,
  actorType: SYSTEM_ACTOR_TYPE,
  action: /* e.g. "certificate.issued_auto" */,
  targetType: "Certificate",
  targetId: /* certificate id */,
  outcome: "SUCCESS",
});
```
Per RESEARCH.md Pattern 3, `issueCertificateAsSystem` is a **plain internal function**, never exported to a route handler — the outer request (lesson-progress write or attendance mark) already went through `withPermission`; issuance itself is not independently permission-gated when system-triggered.

**Anti-pattern warning (DD-6/DD-12/DD-13 boundary — `completion-service.ts` lines 1-56):** Do NOT widen `CompletionServiceTxClient` to add `enrolment.update` — `certificate-issuance-service.ts`'s `Enrolment.status` write needs its own, separate, wider tx-client type. Do NOT read `course.completed`/`programme.completed` `DomainEvent`s as a trigger — hook the synchronous call path only.

---

### `src/server/services/grade-override-service.ts` (MODIFIED — add `reactToGradeOverride` hook)

**Analog:** itself (full file read — 85 lines)

**Current `GradeOverrideDeps` shape to extend** (lines 36-43):
```typescript
export type GradeOverrideDeps = {
  grade: GradeOverrideTx["grade"] extends { findUnique: infer F } ? { findUnique: F } : never;
  enrolmentScope(enrolmentId: string): Promise<ResourceScope> | ResourceScope;
  withPermission: ReturnType<typeof createWithPermission>;
  runInTransaction<R>(fn: (tx: GradeOverrideTx) => Promise<R>): Promise<R>;
  writeEvent: typeof writeDomainEvent;
  audit(entry: ResourceAuditEntry): Promise<void>;
};
```
Add a new slot, e.g. `reactToGradeOverride: (tx: GradeOverrideTx, args: { enrolmentId: string; assessmentId: string; passedChanged: boolean }) => Promise<void>;` — mirrors how `attendance-service.ts`/`lesson-progress-service.ts` already carry `recalculateCompletion` as an injected slot.

**Exact hook point** (inside `overrideGrade`'s existing transaction, line 66 — immediately after the existing `writeEvent` call, lines 52-69):
```typescript
const result = await deps.runInTransaction(async (tx) => {
  const before = await tx.grade.findUnique({ where: { id: input.gradeId } });
  if (!before) throw new Error("Grade not found.");
  if (before.status !== "RELEASED") throw new GradeNotReleasedError();
  // ... score validation, compare-and-set updateMany, gradeOverride.create ...
  await deps.writeEvent(tx, { type: "grade.overridden", payload: { gradeId: before.id, assessmentId: before.assessmentId, enrolmentId: before.enrolmentId, previousScore: before.score, newScore: input.newScore, passedChanged: before.passed !== passed } });
  // NEW: await deps.reactToGradeOverride(tx, { enrolmentId: before.enrolmentId, assessmentId: before.assessmentId, passedChanged: before.passed !== passed });
  const overrides = await tx.gradeOverride.findMany({ where: { gradeId: before.id }, orderBy: { createdAt: "asc" } });
  return { override, grade, overrides, before };
});
```
The real implementation (in `certificate-issuance-service.ts`) does `WHERE enrolmentId = ? AND status = 'ACTIVE'` (per RESEARCH.md's Open Question 1 recommendation — D-01 guarantees at most one certificate type per enrolment) and sets `reviewFlaggedAt = now()` only — never re-derives a verdict, never touches `Enrolment.status`, per CRD-06's grade half.

**Compare-and-set / reason-required pattern to copy for `certificate-service.ts`'s revoke/reissue** (lines 15-20, 50-51, 62-64):
```typescript
export class OverrideReasonRequiredError extends Error {
  constructor() { super("Explain the correction using at least 10 characters."); this.name = "OverrideReasonRequiredError"; }
}
export class GradeChangedError extends Error {
  constructor() { super("This grade changed during the correction. Reload it and try again."); this.name = "GradeChangedError"; }
}
// ...
const reason = input.reason.trim();
if (reason.length < 10) throw new OverrideReasonRequiredError();
// ...
// Compare-and-set prevents simultaneous corrections from overwriting
// each other or recording a previous score that was never current.
const update = await tx.grade.updateMany({ where: { id: before.id, status: "RELEASED", score: before.score }, data: { score: input.newScore, passed } });
if (update.count !== 1) throw new GradeChangedError();
```
Apply the same shape to `Certificate` revoke (mandatory `revocationReason`, compare-and-set on `status: 'ACTIVE'`) and reissue (create a new row, set `supersedesId`, mirroring `GradeOverride`'s `previousScore`/`newScore` linkage).

---

### `src/server/services/certificate-service.ts` (service, CRUD + correction mutation)

**Analogs:** `src/server/services/grade-override-service.ts` (audit-first mutation, above) + `src/server/services/resource-service.ts` (CRUD factory)

**`createResourceService`'s CRUD shape to build the `list`/`get` half on** (`resource-service.ts` lines 188-247):
```typescript
export function createResourceService<T extends { id: string }, C extends ResourceServiceConfig<T> = ResourceServiceConfig<T>>(
  config: C,
): C["restoreData"] extends (id: string) => unknown ? ServiceWithRestore<T> : ServiceBase<T> {
  const { name, delegate, permissions, toScope, withPermission, audit } = config;
  const slug = name.toLowerCase();
  const list = withPermission<{ where?: unknown; scope?: ResourceScope }>(
    permissions.view,
    (input) => input.scope ?? {},
  )(async (input) => delegate.findMany({ where: input.where }));

  const get = withPermission<string>(permissions.view, (id) => toScope(id))(
    async (id) => delegate.findUnique({ where: { id } }),
  );
  // create/update follow, each auditing before/after — see resource-service.ts lines 210-247
}
```
**`ResourceAuditEntry` shape** (lines 36-45) — the audit-row contract every mutation (including revoke/reissue) must satisfy:
```typescript
export type ResourceAuditEntry = {
  action: string;
  targetType: string;
  targetId: string | null;
  actorId: string;
  outcome: string;
  reason: string | null;
  before?: unknown;
  after?: unknown;
};
```
**No-delete discipline** (lines 10-19, header comment) — `Certificate` revoke/reissue must never delete a row, only flip `status`/set `supersedesId`, matching CAT-08.

Use `grade-override-service.ts`'s manual mutation shape (not the bare CRUD factory) for revoke/reissue specifically, since both require a mandatory reason and a compare-and-set guard beyond what `createResourceService.update` provides — `certificates.issue`/`certificates.revoke` gate these, per D-03/CRD-05.

---

### `src/server/services/certificate-template-service.ts` (service, CRUD)

**Analog:** `src/server/services/resource-service.ts`'s `createResourceService` factory (same excerpt as above)

Build `CertificateTemplate` create/update/archive directly on `createResourceService` — no bespoke mutation logic needed, since template authoring has no compare-and-set/reason requirement the factory doesn't already provide. `list`/`get` are read by both the template-editor UI (staff) and `certificate-pdf-renderer.ts` (server-side, at issuance time — reads the template's `layout` JSON, per Pitfall 5's "denormalize at generation time" recommendation).

---

### `src/server/services/certificate-verification-service.ts` (service, pure unauthenticated read)

**Analog:** `src/server/services/readiness-service.ts` (pure evaluator pattern, lines 1-12 header)

```typescript
/**
 * The single readiness evaluator (D-25, D-26, D-27).
 *
 * Pure module: no data-access import, no UI-framework import, no
 * authorization import. It has three consumers ... and it must be
 * callable from all three without dragging any of them in.
 */
export type ReadinessState = "PASS" | "FAIL" | "WARN" | "NOT_YET_CHECKED";
```
Adapt the "named third state, never silently pass" discipline to the verification lookup's three outcomes (per RESEARCH.md Pitfall 3): `{status: "active", ...minimalFields}` / `{status: "revoked", ...minimalFields}` / `{status: "not_found"}` — one function, exactly one of three outcomes, never a different HTTP status or error shape per reason. Because this module needs a Prisma read (unlike `readiness-service.ts`, which is fully pure), it stays under `src/server/services/` per the `@prisma/client`-only-in-services boundary rule, but its exported lookup function should still avoid leaking any Prisma error/exception shape across the three-outcome contract.

---

### `src/server/services/certificate-template-layout.ts` (utility, pure JSON-schema parser)

**Analog:** `src/server/services/completion-rule.ts` (`parseCompletionRule`, versioned `Json?` column + pure parse function — not fully re-read this session beyond RESEARCH.md's own citation, but its shape is directly named as the precedent to copy)

RESEARCH.md's Pattern 4 already derives the target shape directly from this precedent:
```typescript
type CertificateElementV1 =
  | { kind: "text"; field: "learnerName" | "awardTitle" | "issuedAt" | "verificationRef" | "literal";
      literal?: string; x: number; y: number; fontSize: number; color: string; align: "left" | "center" | "right" }
  | { kind: "image"; assetKey: string; x: number; y: number; width: number; height: number }
  | { kind: "border"; style: "solid" | "double"; color: string; widthPt: number };

type CertificateTemplateLayoutV1 = {
  schema: 1;
  pageSize: "A4" | "LETTER";
  orientation: "landscape" | "portrait";
  elements: CertificateElementV1[];
};
```
A `schema: 1` discriminator should reject unrecognised element kinds/fields the same way `completion-rule.ts`'s `UnsupportedCompletionRuleFieldError` does (fail loudly, not silently accept) — this is the V5 Input Validation control RESEARCH.md's Security Domain section requires.

---

### `src/server/services/enrolment-transitions.ts` (MODIFIED — `VALID_TRANSITIONS.COMPLETED`)

**Analog:** itself (full file read, 220 lines)

**Current table** (lines 66-76):
```typescript
export const VALID_TRANSITIONS: Record<EnrolmentStatusValue, EnrolmentStatusValue[]> = {
  PENDING_PAYMENT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["WITHDRAWN", "TRANSFERRED", "COMPLETED", "CANCELLED"],
  WITHDRAWN: [],
  TRANSFERRED: [],
  CANCELLED: [],
  COMPLETED: [],
};
```
D-06 requires `COMPLETED: ["ACTIVE"]` — the comment above the table (lines 61-65, "`COMPLETED` is reachable solely from the Phase 9/11 completion engine and is NOT exposed as a Phase-5 action") must be updated alongside the table edit to also describe the reversal path this phase adds. `assertTransition` (lines 97-106) and `IllegalTransitionError` (lines 79-91) need no changes — the guard function is generic over the table.

**File-isolation rule to respect** (header comment lines 1-35): this module must not import the permission choke point or anything under `next/` — `certificate-issuance-service.ts`'s `Enrolment.status → ACTIVE` reversal write should follow the same "structural cast via unknown" idiom `applyEnrolmentActivation` (lines 173-219) uses for its own tx-client narrowing, not import a wider service.

---

### `src/server/services/enrolment-dashboard-service.ts` (MODIFIED — populate `certificate` column)

**Analog:** itself — the `results`/`assessmentObligations` columns already show the exact "populate a previously-deferred column" shape Phase 10 used.

**Current deferred-column state** (lines 111-115, 259-276, 546-554):
```typescript
const CERTIFICATE_DEFERRED: DeferredColumn = { kind: "deferred", phase: 11 };
// ...
export type LearnerDashboardCard = {
  enrolmentId: string;
  cohortTitle: string;
  timezone: string;
  assessmentObligations: AssessmentObligationsColumn;
  results: ResultsColumn;
  tickets: DeferredColumn;
  certificate: DeferredColumn;   // <- replace with a real CertificateColumn type
  // ...
};
// ...
certificate: CERTIFICATE_DEFERRED,   // <- replace with real per-enrolment lookup
```
Follow the exact same replacement Phase 10 made for `assessmentObligations`/`results` (still `DeferredColumn`-typed for `tickets`, now real for `certificate`) — introduce a `CertificateColumn` union (eligible/issued/revoked/flagged/`none`), keep `tickets: DeferredColumn` untouched (Phase 12's gap, not this phase's).

---

### `src/server/services/storage-service.ts` (MODIFIED — certificate key builders + direct PUT)

**Analog:** itself — `buildSubmissionStorageKey`/`buildStagedSubmissionStorageKey`/`finalSubmissionKeyFor` sibling-function trio (lines 97-145), deliberately NOT a shared generic (per that section's own comment) — add a fourth sibling trio for `certificates/`, not a parameterized version of an existing one.

```typescript
export function buildSubmissionStorageKey({ enrolmentId, assessmentId }: { enrolmentId: string; assessmentId: string }): string {
  return `submissions/${enrolmentId}/${assessmentId}/${randomUUID()}`;
}
export function buildStagedSubmissionStorageKey({ enrolmentId, assessmentId }: { enrolmentId: string; assessmentId: string }): string {
  return `submission-uploads/${enrolmentId}/${assessmentId}/${randomUUID()}`;
}
export function finalSubmissionKeyFor(stagedKey: string): string {
  if (!stagedKey.startsWith("submission-uploads/")) {
    throw new Error("A final key can only be derived from a staged submission upload.");
  }
  return stagedKey.replace(/^submission-uploads\//, "submissions/");
}
```
Certificate PDFs need a **new, fourth pattern** not present yet: a direct (non-presigned) `PutObjectCommand` since the server holds the generated bytes itself (D-07 — always server-generated, never a browser upload). The existing presign-only `presignLessonUploadUrl` (lines 152-165, uses `getSignedUrl`+`PutObjectCommand`) is the closest analog for the `PutObjectCommand` construction, but the new `putGeneratedCertificateObject`-style function calls `s3.send(new PutObjectCommand({...}))` directly (no `getSignedUrl` wrapper) — grep confirms `s3.send`/`PutObjectCommand` are already imported and used at lines 25/158/174/200/211, so no new AWS SDK import is needed, only a new function.

**Download TTL convention** (`src/lib/upload-limits.ts`'s `downloadTtlFor`, cited but not re-read this session — RESEARCH.md's Security Domain table already specifies): reuse the existing 60-second FILE-class TTL for `presignCertificateDownloadUrl`, not the 4-hour VIDEO TTL.

---

### `src/app/api/certificates/[id]/download/route.ts` (route, file-I/O)

**Analog:** `src/app/api/lesson-resources/[id]/download/route.ts` (full file, 90 lines) — replicate exactly, per RESEARCH.md's own Code Examples section.

```typescript
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  try {
    let resource = await getDownloadableResource(id).catch((err) => {
      if (err instanceof permissions.AuthenticationError || err instanceof permissions.AuthorizationError) return null;
      throw err;
    });
    if (!resource) {
      const actor = await getCurrentActor();
      resource = actor ? await getDownloadableResourceForLearner(actor, id) : null;
    }
    if (!resource) return new NextResponse(null, { status: 404 });
    const url = await storage.presignLessonObjectUrl({ /* ... */ });
    // Built by hand rather than via Response.redirect so the no-store header
    // rides along: no shared cache may retain the resolved location.
    return new NextResponse(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    // every failure -> 404, empty body (denial-parity, RBAC-06/T-09-03)
  }
}
```
Swap `getDownloadableResource`/`getDownloadableResourceForLearner` for a certificate-ownership check (owner `userId` match OR `certificates.view` + scope), swap `presignLessonObjectUrl` for the new `presignCertificateDownloadUrl`. Keep the exact 302 + `Cache-Control: private, no-store` construction and the "every non-success outcome is a 404 with empty body" discipline verbatim — this is also the Next 16 Cache Components defense RESEARCH.md Pitfall 6 flags (a Prisma query already defers the handler to request time; do not add `dynamic = 'force-static'` or `'use cache'`).

---

### `src/app/staff/certificates/page.tsx` + `CertificateQueueTable.tsx` + `certificate-actions.ts` (MANUAL-mode eligibility queue, D-04)

**Analog:** `src/app/staff/cohorts/[id]/grading/[assessmentId]/page.tsx` + `GradingQueueTable.tsx` + `src/app/staff/cohorts/[id]/grading-actions.ts` — Phase 10's batch-release queue, explicitly named as this feature's UI precedent in `11-CONTEXT.md` D-04.

**Page (server component, fetch + notFound-on-auth-failure):**
```typescript
export default async function GradingQueuePage({ params }: { params: Promise<{ id: string; assessmentId: string }> }) {
  const { id: cohortId, assessmentId } = await params;
  let rows;
  try {
    const [record, summary] = await Promise.all([cohortService.get(cohortId), listCohortGradingSummary({ cohortId })]);
    // ...
    rows = await listGradingQueue({ cohortId, assessmentId });
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) notFound();
    throw error;
  }
  return <GradingQueueTable cohortId={cohortId} assessmentId={assessmentId} rows={rows} />;
}
```
**Client table (selection + batch server action + `ConfirmModal`):**
```typescript
"use client";
export function GradingQueueTable({ cohortId, assessmentId, rows, onRelease = releaseGradesBatchAction }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, transition] = useTransition();
  function release() {
    transition(async () => {
      const result = await onRelease({ cohortId, gradeIds });
      if (!result.ok) { setError(result.message); return; }
      setOpen(false); setSelected([]);
    });
  }
  return <>
    <ResourceTable /* columns, selection.actions = [{ label: "Release selected", onClick: () => setOpen(true) }] */ />
    <ConfirmModal open={open} tone="default" title={`Release ${gradeIds.length} grades`} pending={pending} error={error} onConfirm={release} onCancel={() => setOpen(false)} />
  </>;
}
```
**Server action (zod-validated input, membership re-check, revalidate):**
```typescript
"use server";
const schema = z.object({ cohortId: z.string().min(1), gradeIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_RELEASE) }).strict();
export async function releaseGradesBatchAction(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "..." };
  try {
    // Resolve the submitted cohort independently; all supplied IDs must belong to its visible queues.
    const result = await releaseGradesBatch({ gradeIds: parsed.data.gradeIds });
    revalidatePath(`/staff/cohorts/${parsed.data.cohortId}`, "layout");
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) return { ok: false as const, message: "Your role does not permit ..." };
    return { ok: false as const, message: "... Reload the queue and try again." };
  }
}
```
For D-04, `/staff/certificates` replaces the batch multi-select with a per-row "Issue" action (or keeps batch-issue if the planner wants parity) gated by `certificates.issue`, backed by the eligibility read-time evaluator (`readiness-service.ts`-pattern query: `CompletionRecord` rows with `supersededAt: null` joined to `certificateIssuanceMode: 'MANUAL'` and no existing `Certificate` — RESEARCH.md Open Question 2's recommendation).

---

### `src/app/verify/[verificationRef]/page.tsx` (public, unauthenticated, CRD-04)

**Analog:** `src/app/(public)/layout.tsx` (existing public route group) — read for contrast, not for direct reuse.

```typescript
const NAV: LearnerNavItem[] = [
  { label: "Courses", href: "/courses" },
  { label: "Programmes", href: "/programmes" },
];
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <LearnerShell nav={NAV} rightSlot={<Link href="/signin">Sign in</Link>}>
      {children}
    </LearnerShell>
  );
}
```
Per RESEARCH.md's explicit Anti-Pattern ("Nesting `/verify/[ref]` under the existing `(public)` route group") and Assumption A3, `/verify/[verificationRef]` needs its **own new, minimal `layout.tsx`** — no `LearnerShell`, no "Sign in" CTA, no catalogue nav. Reuse only the page-level data-fetching shape (server component, `await ctx.params`, `notFound()`-style guard) from the lesson-resources download route and `certificate-verification-service.ts`'s three-outcome contract, not this layout's chrome.

---

## Shared Patterns

### Audit-first mutation (revoke, reissue, manual issue)
**Source:** `src/server/services/grade-override-service.ts` lines 45-73 (full `overrideGrade` body) + `src/server/services/resource-service.ts` lines 36-45 (`ResourceAuditEntry`)
**Apply to:** `certificate-service.ts`'s revoke/reissue, `certificate-actions.ts`'s manual-issue action, `grade-override-service.ts`'s new `reactToGradeOverride` hook.
```typescript
await deps.audit({
  action: "grade.overridden",
  targetType: "Grade",
  targetId: input.gradeId,
  actorId: ctx.actor.userId,
  outcome: "SUCCESS",
  reason,
  before: { score: result.before.score, passed: result.before.passed },
  after: { score: result.grade.score, passed: result.grade.passed },
});
```

### `*AsSystem` actor stamp
**Source:** `src/server/services/checkout-webhook-system-service.ts` line 91, 845-859
**Apply to:** `certificate-issuance-service.ts`'s `issueCertificateAsSystem` (D-03's automatic-issuance writes).
```typescript
export const SYSTEM_ACTOR_TYPE = "SYSTEM";
await deps.audit({ actorId: null, actorType: SYSTEM_ACTOR_TYPE, action: "...", targetType: "Certificate", targetId: id, outcome: "SUCCESS" });
```

### No-hard-delete / supersede-never-destroy
**Source:** `src/server/services/completion-service.ts` lines 305-312 (`applyVerdict`'s supersede branch) + schema's own `Certificate.supersedesId`/`reviewFlaggedAt` fields (already modeled)
**Apply to:** `certificate-service.ts` revoke (never deletes, sets `status: 'REVOKED'`/`revokedAt`/`revocationReason`), reissue (creates new row, links via `supersedesId`), CRD-06 review-flagging (`reviewFlaggedAt`, never overwrites `status` automatically).
```typescript
if (open) {
  // D-12 — stamp supersededAt, never delete, never blank completedAt/evidence.
  await tx.completionRecord.update({ where: { id: open.id }, data: { supersededAt: now } });
  return "superseded";
}
```

### Partial unique index for concurrency-safe idempotency
**Source:** `prisma/migrations/20260901115332_init/migration.sql` lines 1216-1218
**Apply to:** `Certificate` (Pitfall 4 — one ACTIVE certificate per enrolment/scope).
```sql
CREATE UNIQUE INDEX enrolment_one_active_per_learner_cohort
  ON "Enrolment" ("userId", "cohortId")
  WHERE status = 'ACTIVE';
```
New index (add to the new migration's raw-SQL trailer, same file/section convention):
```sql
CREATE UNIQUE INDEX certificate_one_active_per_enrolment_scope
  ON "Certificate" ("enrolmentId", "scope")
  WHERE status = 'ACTIVE';
```
Pair with a `P2002` catch treated as "already issued, no-op" — same shape `resource-service.ts`'s `withPositionRetry`/`PositionContentionError` (lines 61-68, 256+) already uses for a different index.

### Denial-parity / every-failure-is-404
**Source:** `src/app/api/lesson-resources/[id]/download/route.ts` lines 12-14, 76-88 (full file)
**Apply to:** `src/app/api/certificates/[id]/download/route.ts` (download), `certificate-verification-service.ts` (public lookup — adapted to page-level "not found" rendering rather than an HTTP 404, since it's a page not a route, but the discipline is identical: no response-shape or status difference based on *why* a lookup failed).

### `@prisma/client` boundary
**Source:** project-wide ESLint rule + `tests/boundary.test.ts` (cited in CONTEXT.md/RESEARCH.md, not independently re-read this session)
**Apply to:** every new `src/server/services/*.ts` file in this phase — `@prisma/client` types/imports stay confined to `src/server/services/`; `certificate-pdf-renderer.ts` and `certificate-template-layout.ts` should stay as close to pure (no Prisma import) as `completion-rule.ts`/`readiness-service.ts` manage, taking structural input types instead.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/app/staff/certificates/templates/` (canvas editor UI — element palette, drag-to-position, style panel) | component | request-response | No comparable drag/position canvas UI exists anywhere in this codebase (RESEARCH.md: "Template-editor canvas mechanics: LOW — no comparable UI exists in this codebase yet"). Plan this as genuinely new UI work; the only reusable piece is `certificate-template-layout.ts`'s JSON shape (editor writes/reads the same `CertificateTemplateLayoutV1` the renderer consumes) and `resource-service.ts`'s CRUD factory for save/load persistence. |
| `src/server/services/certificate-pdf-renderer.ts`'s internal PDF-drawing calls (`drawText`/`drawImage`/`drawRectangle` or `pdfkit` equivalent) | utility | transform | No PDF-construction code exists anywhere in this codebase yet — this is the first pass (RESEARCH.md's own State of the Art: "no prior certificate implementation exists to deprecate"). The library choice itself (`pdf-lib`+`@pdf-lib/fontkit` vs `pdfkit`) is still gated behind the mandatory human legitimacy checkpoint per CONTEXT.md's Claude's-Discretion item — do not begin this file until that checkpoint clears. |

## Metadata

**Analog search scope:** `src/server/services/` (all ~65 files, scanned by name; ~14 read in full or targeted sections this session), `src/app/staff/`, `src/app/(public)/`, `src/app/api/lesson-resources/`, `prisma/schema.prisma`, `prisma/migrations/20260901115332_init/migration.sql`, `src/server/permissions/catalogue.ts`
**Files scanned:** 24 read (full or targeted-range) + directory listings for `src/app/staff/*`, `src/server/services/*`
**Pattern extraction date:** 2026-09-16
