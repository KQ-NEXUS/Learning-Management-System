---
phase: 11-certificates-completion-lifecycle
reviewed: 2026-09-19T00:00:00Z
depth: standard
files_reviewed: 60
files_reviewed_list:
  - prisma/seed.ts
  - src/app/(learner)/dashboard/page.tsx
  - src/app/api/certificates/[id]/download/route.ts
  - src/app/staff/certificates/CertificateQueueTable.tsx
  - src/app/staff/certificates/RecentlyIssuedList.tsx
  - src/app/staff/certificates/certificate-actions.ts
  - src/app/staff/certificates/issued/IssuedCertificatesTable.tsx
  - src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx
  - src/app/staff/certificates/issued/[id]/certificate-record-actions.ts
  - src/app/staff/certificates/issued/[id]/page.tsx
  - src/app/staff/certificates/issued/page.tsx
  - src/app/staff/certificates/page.tsx
  - src/app/staff/certificates/templates/ElementInspector.tsx
  - src/app/staff/certificates/templates/TemplateCanvas.tsx
  - src/app/staff/certificates/templates/TemplateEditorShell.tsx
  - src/app/staff/certificates/templates/TemplatesTable.tsx
  - src/app/staff/certificates/templates/[id]/page.tsx
  - src/app/staff/certificates/templates/new/page.tsx
  - src/app/staff/certificates/templates/page.tsx
  - src/app/staff/certificates/templates/template-actions.ts
  - src/app/staff/certificates/templates/template-asset-actions.ts
  - src/app/staff/courses/CourseForm.tsx
  - src/app/staff/courses/[id]/edit/page.tsx
  - src/app/staff/courses/[id]/page.tsx
  - src/app/staff/courses/actions.ts
  - src/app/staff/courses/course-schema.ts
  - src/app/staff/courses/new/page.tsx
  - src/app/staff/layout.tsx
  - src/app/staff/programmes/ProgrammeForm.tsx
  - src/app/staff/programmes/[id]/page.tsx
  - src/app/staff/programmes/actions.ts
  - src/app/staff/programmes/new/page.tsx
  - src/app/verify-certificate/layout.tsx
  - src/app/verify-certificate/page.tsx
  - src/app/verify/VerifyReferenceForm.tsx
  - src/app/verify/[verificationRef]/page.tsx
  - src/app/verify/layout.tsx
  - src/components/catalogue/CertificateSettingsFields.tsx
  - src/components/catalogue/index.ts
  - src/components/learner/CertificateSlot.tsx
  - src/components/learner/NextUpCard.tsx
  - src/lib/certificate-display-status.ts
  - src/lib/permission-groups.ts
  - src/server/permissions/catalogue.ts
  - src/server/services/attendance-service.ts
  - src/server/services/certificate-default-template-layout.ts
  - src/server/services/certificate-issuance-service.ts
  - src/server/services/certificate-pdf-renderer.ts
  - src/server/services/certificate-reference.ts
  - src/server/services/certificate-service.ts
  - src/server/services/certificate-template-layout.ts
  - src/server/services/certificate-template-service.ts
  - src/server/services/certificate-verification-service.ts
  - src/server/services/domain-event-service.ts
  - src/server/services/enrolment-dashboard-service.ts
  - src/server/services/enrolment-transitions.ts
  - src/server/services/grade-override-service.ts
  - src/server/services/learner-access.ts
  - src/server/services/lesson-progress-service.ts
  - src/server/services/storage-service.ts
findings:
  critical: 6
  warning: 10
  info: 6
  total: 22
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-09-19
**Depth:** standard
**Files Reviewed:** 60
**Status:** issues_found

## Summary

The security-critical surfaces the brief singled out are largely sound. Public verification selects exactly
`status/learnerName/awardTitle/issuedAt`, returns a bare `{ status: "not_found" }`, and never touches revocation
reason or user id. The download route returns 404 for every denial, uses a 60 s presigned URL and sends
`Cache-Control: private, no-store`. Issuance uses `createMany({ skipDuplicates })` correctly, and the D-01
Programme-cohort skip is present in both the `created` and `superseded` branches. Server actions are `.strict()`
where it matters and do not pass raw `error.message` to the browser. The `COMPLETED` read path in
`learner-access.ts` is opt-in (`includeCompleted`) and `assertLessonOpenable` refuses it.

The defects are in the lifecycle logic and in the coupling of PDF rendering to the caller's transaction. The
worst is that any render failure rolls back the learner's lesson-progress write or the staff attendance write
that triggered issuance. Several distinct, easy-to-hit inputs cause such a failure: a non-Latin learner name, a
WebP/GIF logo, or a Withdrawn enrolment. The D-06 reversal (revoke or flag returns the enrolment to `ACTIVE`)
has holes. A revoked certificate can be silently reissued by automation, a flagged certificate can never return
the enrolment to `COMPLETED`, and the reversal collides with the `enrolment_one_active_per_learner_cohort`
partial index.

## Critical Issues

### CR-01: Non-WinAnsi text in a certificate field makes PDF rendering throw, rolling back the triggering learner/staff write

**File:** `src/server/services/certificate-pdf-renderer.ts:158,179,252`
**Issue:** The renderer embeds only `StandardFonts.Helvetica` (WinAnsi). `font.widthOfTextAtSize(value, ...)`
and `drawText` throw `WinAnsi cannot encode "<char>"` for any character outside WinAnsi. That includes Arabic,
CJK, Cyrillic, most Vietnamese and Turkish letters, any emoji, and `\n` in a literal. `learnerName` (from
`User.name`), `awardTitle` (from `Course.title`) and staff-authored literals all flow in unfiltered.
`issueCertificateForEnrolment` runs this render inside the caller's transaction (`certificate-issuance-service.ts:415`).
The learner's lesson-progress write, or the staff attendance mark that satisfied the rule, therefore fails with
an unhandled error and can never succeed.

Failure scenario: a learner named "محمد" completes the last required lesson in an `AUTOMATIC` course.
`recalculateCompletionAndIssue` returns `created`, issuance renders, pdf-lib throws, and the whole transaction
rolls back. The lesson cannot be marked complete, ever. `D-08` and the decisions file approve `@pdf-lib/fontkit`,
but it is never used.

**Fix:** Embed a Unicode font via fontkit (`document.registerFontkit(fontkit)` then `embedFont(bytes, { subset: true })`).
As a minimum, sanitise before drawing so rendering can never abort the caller's write.
```ts
function encodable(font: PDFFont, text: string): string {
  return Array.from(text.replace(/[\r\n]+/g, " ")).filter((ch) => {
    try { font.encodeText(ch); return true; } catch { return false; }
  }).join("");
}
const value = encodable(font, resolveTextElementValue(element, fields));
```
Also decouple render failure from the learner transaction (see WR-01).

### CR-02: Template image assets accept WebP/GIF but the renderer only embeds PNG/JPEG, so every issuance from that template throws

**File:** `src/server/services/certificate-pdf-renderer.ts:195-200`, `src/app/staff/certificates/templates/template-asset-actions.ts:173-181`, `src/app/staff/certificates/templates/ElementInspector.tsx:212`
**Issue:** The upload allow-list (`upload-limits.ts` IMAGE) and the inspector's `accept` include `image/webp` and
`image/gif`. `drawImageElement` does `embedPng`, and on failure `embedJpg`. pdf-lib supports neither WebP nor
GIF, so the second call throws inside the render. The asset was "verified" and promoted, and the layout parser
accepts any non-empty `assetKey`, so the template saves fine. Every subsequent automatic issuance for every
Course/Programme using that template then throws inside the learner's transaction (same blast radius as CR-01).

**Fix:** Restrict template assets to `image/png` and `image/jpeg` in `presignTemplateAssetUploadAction` and
`confirmTemplateAssetUploadAction`, and narrow the inspector `accept`. Do not reuse the generic IMAGE list. For a
defence in depth, catch embed errors in `drawImageElement` and skip the image rather than abort issuance:
```ts
const TEMPLATE_ASSET_MIME = ["image/png", "image/jpeg"] as const;
```

### CR-03: Issuing for a non-ACTIVE enrolment throws `IllegalTransitionError`, blocking attendance writes and manual issuance

**File:** `src/server/services/certificate-issuance-service.ts:438-441`, `src/server/services/attendance-service.ts:85,484-495`, `src/server/services/certificate-service.ts:311-372`
**Issue:** After the row is created and the PDF stored, `assertTransition(enrolment.status, "COMPLETED", ...)`
runs. `VALID_TRANSITIONS` only permits `ACTIVE -> COMPLETED`. Attendance marking only excludes
`TRANSFERRED`/`CANCELLED` (`OFF_ROSTER_STATUSES`), so `WITHDRAWN` and `PENDING_PAYMENT` enrolments can still be
marked. If such an enrolment satisfies its rule under an `AUTOMATIC` award, `reactToCompletionResults` calls
`issueCertificateForEnrolment` and the assert throws. The staff member's attendance write then fails. Nothing
in `reactToCompletionResults` or `issueCertificateForEnrolment` checks `enrolment.status` before issuing.

The manual queue has the same gap. `computePendingIssuance` never filters on enrolment status, so withdrawn
learners appear and "Issue" always fails with a generic message.

**Fix:** Gate issuance on status before any write. Decide explicitly for `WITHDRAWN`:
```ts
if (enrolment.status !== "ACTIVE" && enrolment.status !== "COMPLETED") {
  return { kind: "not-eligible" }; // add to IssueCertificateOutcome and map in certificate-actions.ts
}
```
Filter the pending queue with `enrolment: { status: { in: ["ACTIVE", "COMPLETED"] } }`.

### CR-04: A revoked certificate is silently reinstated by the next automatic issuance

**File:** `src/server/services/certificate-issuance-service.ts:326-331,649-657,666-687`
**Issue:** The "already issued" pre-check and the partial unique index only consider `status = 'ACTIVE'`.
After staff revoke a certificate (`REVOKED`, enrolment reverted to `ACTIVE`), the completion record is still
satisfied. Any later supersede-then-create cycle produces a `created` result. A learner can self-undo and redo a
lesson (D-13/D-15), or staff can correct attendance twice. In an `AUTOMATIC` award, `issueCertificateForEnrolment`
then finds no ACTIVE certificate and issues a brand-new one, with the enrolment back at `COMPLETED`. The
staff revocation (CRD-05, possibly for misconduct) is defeated by automation and there is no revocation
tombstone check.

**Fix:** Before creating, refuse if a `REVOKED` certificate exists for the enrolment/scope that has not been
superseded, and require an explicit staff reissue.
```ts
const revoked = await tx.certificate.findFirst({ where: { enrolmentId, scope, status: "REVOKED" } });
if (revoked && actor === null) return { kind: "revoked-blocked" };
```

### CR-05: After a CRD-06 flag the enrolment can never return to `COMPLETED`, and no path clears the flag

**File:** `src/server/services/certificate-issuance-service.ts:329-331,511-515`, `src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx:82-106`, `src/app/staff/certificates/issued/[id]/page.tsx:151-160`
**Issue:** `flagCertificateForReview` sets `reviewFlaggedAt` and reverts `COMPLETED -> ACTIVE` (D-06). Nothing
ever clears `reviewFlaggedAt` (a repo-wide grep finds only the one write). When the learner's completion is
re-satisfied the reactive path returns `already-issued` at line 330 and never moves the enrolment back to
`COMPLETED`. The flagged banner tells staff to "confirm it should remain active, or revoke it", but the UI
offers only "Revoke certificate" for a flagged certificate. Reissue is shown only for `revoked`.

Failure scenario: a grade override that does not cross the pass mark flags a good certificate. The enrolment
drops to `ACTIVE`. The cert is flagged forever, the learner sees "under review" indefinitely, and the enrolment
is stuck `ACTIVE` unless staff destroy the credential (revoke) and reissue it. D-06 says the learner can
"re-complete once the correction is resolved".

**Fix:** Add a "Confirm certificate is valid" action (`certificates.issue`, mandatory reason, audited) that clears
`reviewFlaggedAt` and restores `COMPLETED` through `assertTransition("ACTIVE","COMPLETED")` if the completion
record is still satisfied. In the `already-issued` branch, restore `COMPLETED` when the enrolment is `ACTIVE`
and the existing certificate is not flagged.

### CR-06: Moving to `COMPLETED` frees the one-ACTIVE-enrolment index; the D-06 reversal then fails on a duplicate

**File:** `src/server/services/certificate-issuance-service.ts:438-441,511-515`, `src/server/services/certificate-service.ts:558-562`, `prisma/migrations/20260901115332_init/migration.sql:1216-1218`
**Issue:** `enrolment_one_active_per_learner_cohort` is `UNIQUE (userId, cohortId) WHERE status = 'ACTIVE'`. The
Phase 9 DD-6 header explicitly warns that moving to `COMPLETED` "would silently free" this index and permit a
duplicate enrolment. Phase 11 introduces exactly that transition without widening the index. The Phase 11
migration only adds the certificate index. Once an enrolment is `COMPLETED`, staff or checkout can enrol the same
learner in the same cohort, and that enrolment is `ACTIVE`. A later revoke or CRD-06 flag then tries
`COMPLETED -> ACTIVE` on the first enrolment and violates the index (P2002). That aborts the transaction:
`revokeCertificate` fails permanently, and, worse, `flagCertificateForReview` running inside a learner's
lesson-progress or a staff attendance transaction fails that write.

**Fix:** In a new migration, recreate the index over both statuses:
```sql
DROP INDEX enrolment_one_active_per_learner_cohort;
CREATE UNIQUE INDEX enrolment_one_live_per_learner_cohort
  ON "Enrolment" ("userId","cohortId") WHERE status IN ('ACTIVE','COMPLETED');
```
Also confirm the checkout and staff-enrol duplicate guards treat `COMPLETED` as live.

## Warnings

### WR-01: Certificate issuance (S3 read, PDF render, S3 write) runs inside the caller's default 5 s interactive transaction

**File:** `src/server/services/lesson-progress-service.ts:794`, `src/server/services/attendance-service.ts:806`, `src/server/services/certificate-issuance-service.ts:408-428`
**Issue:** The composition roots call `client.$transaction(fn)` with no `timeout`/`maxWait`, so Prisma's default 5 s
timeout applies. `renderCertificatePdf` may `getObjectBytes` per image element, embed images, then
`putGeneratedCertificateObject` runs, all before commit. A slow object store or large logo produces P2028 and the
learner's completion write is lost. The stored object also becomes an orphan (nothing deletes it on rollback,
contrary to the comment at lines 408-414, which covers only the DB rows).
**Fix:** Persist the certificate row with `storageKey: null` in the caller's transaction and render/store in a
post-commit step (or a retryable job) with a "generating" state. At minimum, pass `{ timeout: 30_000 }` at
these roots.

### WR-02: Issuance audit is written outside the transaction; revoke/reissue audit is written after commit

**File:** `src/server/services/certificate-issuance-service.ts:443-451`, `src/server/services/certificate-service.ts:578-587,664-673`
**Issue:** `deps.audit` is `recordAudit` on the global client, not the caller's `tx`. If the enclosing
transaction later rolls back (a throw at any later step, or the timeout in WR-01), a durable
`certificate.issued_auto` audit row remains for a certificate id that never existed. Conversely, in
`revokeCertificate`/`reissueCertificate` the audit is written after the transaction commits. A failure of
`recordAudit` leaves a committed revocation with no audit and a client-visible error. The file header advertises
"audit-first".
**Fix:** Write the audit row with the same `tx` (or a tx-bound audit function) so the mutation and its audit
commit or roll back together.

### WR-03: Template image `assetKey` is not restricted to the template-asset key domain

**File:** `src/server/services/certificate-template-layout.ts:149-158`, `src/server/services/storage-service.ts:339-347`, `src/server/services/certificate-issuance-service.ts:709`
**Issue:** The parser accepts any non-empty string as `assetKey`. `liveIssuanceDeps.resolveTemplateAsset` passes it
straight to `getObjectBytes`, which reads any object in the bucket. A holder of only `certificates.manage` who
learns another object's key (`submissions/...`, `lessons/...`, `certificates/...`) can embed that image into
every certificate rendered from the template. A typo also breaks all issuance from the template (see CR-02
blast radius). `finalTemplateAssetKeyFor` proves the intended prefix exists, but nothing enforces it at save or
read time.
**Fix:** Validate in the parser (`startsWith("certificate-template-assets/")`, no `..`) and re-check in
`resolveTemplateAsset` before `getObjectBytes`.

### WR-04: `no-template` (and other non-issued) outcomes are silently ignored for AUTOMATIC awards, leaving a dead end

**File:** `src/server/services/certificate-issuance-service.ts:653-657`, `src/server/services/certificate-service.ts:343,360`
**Issue:** `reactToCompletionResults` discards the return of `issueCertificateForEnrolment`. If there is no
default template (all archived, or a cleared default), the outcome is `no-template` and the completion is
recorded but no certificate is issued. The completion result is then `unchanged` on every later evaluation, so
issuance is never retried. `computePendingIssuance` only lists `MANUAL` awards, so staff have no queue entry
either. The dashboard shows "being finalized by your instructor" forever.
**Fix:** Surface non-`issued`/`already-issued` outcomes (audit + domain event at minimum), and include
`AUTOMATIC` awards with a completion record but no ACTIVE certificate in the staff queue.

### WR-05: A learner regains download of a revoked certificate once it is superseded

**File:** `src/server/services/certificate-service.ts:401-410`, `src/server/services/certificate-service.ts:617-620`
**Issue:** The learner predicate excludes only `REVOKED`. `reissueCertificate` allows reissue from a `REVOKED`
row and flips it to `SUPERSEDED`. From then on `getOwnCertificateForDownload` returns the old, revoked-then-superseded
PDF to its owner. The download route hands out a presigned URL for a credential that was withdrawn (it also
does so for a normal superseded one, whose verify page reads "revoked"). The old file keeps circulating.
**Fix:** Return `null` for anything other than the current `ACTIVE` row in the learner predicate
(`if (row.status !== "ACTIVE") return null`).

### WR-06: Dashboard certificate column picks an arbitrary row when REVOKED and ACTIVE coexist, and shows "being finalized" for awards that issue nothing

**File:** `src/server/services/enrolment-dashboard-service.ts:466,848,856`
**Issue:** The batched query returns every non-`SUPERSEDED` certificate. After a revoke followed by an automatic
re-issue (CR-04), a `REVOKED` and an `ACTIVE` row share one `enrolmentId:scope` key, and `new Map(...)` keeps
whichever comes last (no `orderBy`). The learner may be told their valid certificate is revoked, or vice versa.
Separately, `deriveCertificateColumn` returns `pending-issuance` whenever a completion record exists and no
certificate row does, regardless of `certificateEnabled`. Every learner finishing a Course with certificates
disabled (the Course default) sees "Your certificate is being finalized by your instructor."
**Fix:** Order/prefer `ACTIVE`, then flagged, then `REVOKED` when building the map. Pass `certificateEnabled` into
the column derivation and return a distinct `not-applicable` kind.

### WR-07: Re-running the seed clobbers an edited default template and can create two defaults

**File:** `prisma/seed.ts:193-215`
**Issue:** On re-run the seed finds the row by name and overwrites `layout`, `isDefault: true` and
`archivedAt: null`. If staff edited that template's layout, their work is lost. If staff set a different template as
default (or archived this one), the seed forces `isDefault: true` without clearing the other default, so two
`isDefault` rows exist. `resolveTemplate` (`findFirst({ isDefault: true })`, no ordering) then picks
nondeterministically. There is no DB constraint preventing multiple defaults.
**Fix:** Create-only when absent; never update an existing template. Add a partial unique index
`ON "CertificateTemplate"("isDefault") WHERE "isDefault"` and order `resolveTemplate` deterministically.

### WR-08: Archived-template immutability is UI-only

**File:** `src/app/staff/certificates/templates/template-actions.ts:90-106`, `src/server/services/certificate-template-service.ts:176-178`, `src/app/staff/certificates/templates/[id]/page.tsx:9-14`
**Issue:** The page comment claims an archived template's layout "can never be mutated again (T-11-37)". This is
enforced only by hiding the save button. `saveTemplateLayoutAction` accepts any `id`, and
`certificateTemplateService.update` never checks `archivedAt`. A crafted call edits a template that already-issued
certificates and existing Course pointers rely on.
**Fix:** In `certificateTemplateService.update`, load the row and throw `ArchivedTemplateError` when
`archivedAt` is set.

### WR-09: Editing a Course/Programme as a role without `certificates.view` silently resets the chosen template

**File:** `src/app/staff/courses/[id]/edit/page.tsx:41-62`, `src/app/staff/courses/actions.ts:28-33,157-162`, `src/app/staff/programmes/actions.ts:143-156`
**Issue:** When `listSelectableTemplates()`/`certificateTemplateService.get()` are denied, the edit page renders the
picker with an empty list and no archived option. The `<select>` then shows and submits `""`, which the action
maps to `null` ("use default"). For a Course, `null !== current.certificateTemplateId` passes
`assertTemplateSelectable(null)`, so an unrelated edit overwrites a deliberately chosen template with the
default. The same happens on the programme edit action.
**Fix:** Render the picker `disabled` (so the key is omitted, treated as `undefined`) when the template list
could not be loaded, or render a hidden preserving field.

### WR-10: Pending-issuance queue never syncs to fresh server data

**File:** `src/app/staff/certificates/CertificateQueueTable.tsx:21-22`
**Issue:** `useState(initialRows)` captures the prop once. After `issueCertificateAction`'s `revalidatePath`
delivers fresh `rows`, the component keeps its stale local copy. Rows newly made eligible do not appear, and rows
already issued by another staff member remain until a hard reload. A row returned as `already-issued` stays
listed.
**Fix:** Derive from props (keep only an "optimistically removed" set in state) or add a `key` from the row ids
so the component remounts on new data.

## Info

### IN-01: PDF issued date uses server-local timezone while the verify page uses UTC

**File:** `src/server/services/certificate-pdf-renderer.ts:69-75` vs `src/app/verify/[verificationRef]/page.tsx:25-32`
**Issue:** `formatCertificateIssuedDate` has no `timeZone`; the verify page pins `UTC`. On a non-UTC host near
midnight, the printed date and the public verified date differ by a day.
**Fix:** Pin `timeZone: "UTC"` (or the school's zone) in the renderer and share one formatter.

### IN-02: Reissue emits both `certificate.issued` and `certificate.reissued` domain events

**File:** `src/server/services/certificate-issuance-service.ts:454-458`, `src/server/services/certificate-service.ts:650-659`
**Issue:** Reissue delegates to `issueCertificateForEnrolment`, which writes `certificate.issued` (and an audit row
`certificate.issued`, which `getCertificateIssuer` then reports as the "issuer"). Phase 13 draining both events
would send two emails for one reissue.
**Fix:** Let the caller suppress the issued event/audit (`input.suppressIssuedEvent`) or make the drain
de-duplicate on `certificateId`.

### IN-03: Public verify is case-sensitive and a NUL byte in the path segment reaches the database

**File:** `src/server/services/certificate-verification-service.ts:62-75`
**Issue:** References are stored upper-case, but the lookup only trims. A lower-case transcription reports "not
found" for a valid certificate. A `%00` segment is passed to Prisma and can raise an error, which the module
deliberately propagates (a 500 on a public route).
**Fix:** `toUpperCase()` after trim, and short-circuit to `not_found` unless the reference matches `/^CERT-[0-9A-F]{32}$/`.

### IN-04: `listPendingIssuance`'s `scope` parameter is authorised on but never applied to the query

**File:** `src/server/services/certificate-service.ts:311-384`
**Issue:** `withPermission("certificates.view", (input) => input.scope ?? {})` checks the scope, but
`computePendingIssuance` ignores it and returns every learner. Today only the unscoped page calls it (which
needs a global grant), so nothing leaks, but the first scoped caller would see all learners' names.
**Fix:** Filter by the scope or remove the `scope` argument.

### IN-05: Dead and stale code

**File:** `src/server/services/certificate-issuance-service.ts:184-186,769-773`, `src/components/learner/CertificateSlot.tsx:57`
**Issue:** `completionRecord` is declared on `CertificateIssuanceTxClient` and never read. `withCertificateIssuanceTransaction`
is unused. The `not-complete` state still reads "Certificate — arriving in a future update" although
certificates now ship.
**Fix:** Remove the unused members and update the copy.

### IN-06: Editor details

**File:** `src/app/staff/certificates/templates/TemplateEditorShell.tsx:132-140`, `src/app/staff/certificates/templates/ElementInspector.tsx:180-194`, `src/app/staff/certificates/templates/TemplateCanvas.tsx:320`
**Issue:** `addElement` calls `setSelectedIndex` inside the `setElements` updater (a side effect in an updater).
`uploadChosenFile` closes over the element from when the upload began, so `onChange({ ...currentElement, assetKey })`
overwrites any x/y/size edits made during the upload. The canvas border uses a fixed `inset-3` while the PDF
insets 24 pt, so the preview does not match the output.
**Fix:** Move the selection update out of the updater, apply only `{ assetKey }` on the latest element, and
scale the preview border inset from `BORDER_INSET_PT`.

---

_Reviewed: 2026-09-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
