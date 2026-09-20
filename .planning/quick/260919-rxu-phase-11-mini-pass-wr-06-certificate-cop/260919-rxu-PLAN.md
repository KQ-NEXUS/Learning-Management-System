---
phase: quick-260919-rxu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server/services/enrolment-dashboard-service.ts
  - src/components/learner/CertificateSlot.tsx
  - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx
  - src/server/services/certificate-service.ts
  - src/server/services/certificate-template-layout.ts
  - tests/enrolment-dashboard-service.test.ts
  - tests/certificate-slot.test.ts
  - tests/components/certificate-slot.test.tsx
  - tests/learner-dashboard-page.test.ts
  - tests/components/grade-entry-client.test.tsx
  - tests/certificate-service.test.ts
  - tests/certificate-download.integration.test.ts
  - tests/certificate-template-layout.test.ts
  - tests/certificate-template-service.test.ts
autonomous: true
requirements: [WR-06, WR-05, WR-03]
must_haves:
  truths:
    - "A learner completing a Course or Programme whose certificateEnabled is false, with no certificate row, sees NOTHING certificate-related on their dashboard card (no 'being finalized', no 'arriving in a future update')."
    - "A learner in a certificateEnabled award still sees pending-issuance / not-complete / issued / flagged / revoked exactly as before; an existing certificate row always wins over the disabled flag."
    - "The dashboard resolves certificateEnabled for every card with ONE course query and ONE programme query per loadLearnerDashboard call (no N+1)."
    - "The staff grade-entry line no longer says 'not yet evaluated (arriving in a future update)'; it says a correction flags any active certificate for review."
    - "getOwnCertificateForDownload returns the row only for the owner AND status ACTIVE; REVOKED and SUPERSEDED both return null; a flagged-but-ACTIVE certificate still returns."
    - "The template layout parser accepts an image assetKey only under 'certificate-template-assets/' with a non-empty, traversal-free remainder; foreign keys are rejected on both template create and update."
    - "The seeded default template and any layout saved through the confirm flow (certificate-template-assets/<templateId-or-draft>/<uuid>) still parse."
  artifacts:
    - path: "src/server/services/enrolment-dashboard-service.ts"
      provides: "certificateEnabled-aware deriveCertificateColumn, not-applicable CertificateColumn kind, batched course/programme certificateEnabled reads"
      contains: "not-applicable"
    - path: "src/server/services/certificate-service.ts"
      provides: "ACTIVE-only learner download predicate"
      contains: "status !== \"ACTIVE\""
    - path: "src/server/services/certificate-template-layout.ts"
      provides: "assetKey prefix/traversal validation in the pure parser"
      contains: "certificate-template-assets/"
  key_links:
    - from: "src/server/services/enrolment-dashboard-service.ts loadLearnerDashboard"
      to: "store.course.findMany / store.programme.findMany"
      via: "one batched read each, awards keyed by scope+id"
      pattern: "certificateEnabled"
    - from: "src/server/services/certificate-template-service.ts (UNCHANGED)"
      to: "parseCertificateTemplateLayout"
      via: "validatedCreateData / validatedUpdateData already call the parser"
      pattern: "parseCertificateTemplateLayout"
---

<objective>
Phase 11 mini-pass: fix exactly three verifier findings the human chose to fix
(WR-06 + stale copy, WR-05, WR-03). WR-02 is ACCEPTED and CR-05 stays deferred:
do NOT touch audit atomicity and do NOT add any flag-clearing / "Clear flag"
control (11-DECISIONS.md, 11-CONTEXT.md).

Purpose: stop telling learners of no-certificate awards that a certificate is
coming, stop owners downloading withdrawn (superseded) PDFs, and stop a
`certificates.manage` holder embedding arbitrary bucket objects into certificates.
Output: three TDD fixes, each with tests run RED first, committed separately.

This task needs NO route/page/proxy changes, so the Next.js docs read demanded by
AGENTS.md does not apply; if anything unexpectedly touches a route, read the
matching guide in node_modules/next/dist/docs/ first.
</objective>

<execution_context>
@C:/Users/disuk/Learning-Management-System/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/disuk/Learning-Management-System/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/11-certificates-completion-lifecycle/11-VERIFICATION.md
@.planning/phases/11-certificates-completion-lifecycle/11-REVIEW.md
@src/server/services/enrolment-dashboard-service.ts
@src/components/learner/CertificateSlot.tsx
@src/server/services/certificate-service.ts
@src/server/services/certificate-template-layout.ts
@src/server/services/certificate-template-service.ts

<interfaces>
<!-- Extracted from the codebase; use directly, no exploration needed. -->

enrolment-dashboard-service.ts (today):
- type CertificateColumn = not-complete | pending-issuance | issued{certificateId,verificationRef,issuedAt} | flagged{same} | revoked
- export function deriveCertificateColumn(input: { hasCompletionRecord: boolean; certificate: DashboardCertificateStoreRow | null }): CertificateColumn
- type EnrolmentDashboardStore = { scheduledSession, attendanceRecord, completionRecord, certificate } (each a narrow findMany slice)
- buildCardContext(actor, enrolment, nowDate, certificateContext: { hasCompletionRecord; certificate }) calls deriveCertificateColumn(certificateContext)
- loadLearnerDashboard batches completionRecord + certificate reads ONCE in a Promise.all over `enrolmentIds`, keys maps by `${enrolmentId}:${scope}`, scope = enrolment.cohort.programmeId ? "PROGRAMME" : "COURSE"
- OwnEnrolmentSnapshot.cohort has courseId: string | null and programmeId: string | null (learner-access.ts)
- live binding: `const liveStore = prisma as unknown as EnrolmentDashboardStore`

Prisma: Course.certificateEnabled Boolean @default(false); Programme.certificateEnabled Boolean @default(true).

certificate-service.ts getOwnCertificateForDownload(actor: {userId}, certificateId): Promise<CertificateRow | null>
  currently: findUnique; null if !row; null if row.userId !== actor.userId; null if row.status === "REVOKED"; else row.

certificate-template-layout.ts: pure module (NO imports — keep it that way; tests/certificate-phase-invariants.test.ts guards purity).
  parseImageElement currently: assetKey must be a string and .trim() !== "" then copied verbatim.
  fail(issue) throws UnsupportedCertificateLayoutError; existing call is fail("assetKey") (does not echo the key — keep it that way).

certificate-template-service.ts (NO change needed): validatedCreateData and validatedUpdateData already run
  parseCertificateTemplateLayout before the delegate write; certificate-file-service.ts:255 re-parses the stored layout
  before every render. So the parser is the single right layer: it covers save AND read-time.

Valid asset keys in production (storage-service.ts): buildTemplateAssetStorageKey -> certificate-template-assets/<templateId>/<uuid>;
finalTemplateAssetKeyFor maps certificate-template-asset-uploads/<x> -> certificate-template-assets/<x> (e.g. certificate-template-assets/draft/<uuid>).
The editor's PENDING_UPLOAD_ASSET_KEY = "pending-upload" is blocked client-side before save (TemplateEditorShell) and will now also be rejected server-side.
</interfaces>
</context>

<constraints_for_every_task>
- TDD: write/adjust the tests FIRST, run them and CONFIRM they FAIL (RED) against current code for the reason the fix addresses, only then change production code and run GREEN. Record the RED result in the SUMMARY.
- No npm/pip installs. Never run prisma migrate / db push / db execute. Never use the DATABASE_URL in .env (the integration test starts its own Testcontainers Postgres/MinIO and sets DATABASE_URL itself; Docker is up).
- Vitest only via: powershell.exe -NoProfile -Command "npx vitest run <files>". Pass explicit file paths. NEVER run the whole suite in the foreground.
- Also run tests/boundary.test.ts and tests/certificate-phase-invariants.test.ts at the end (run the invariants file ALONE if it times out under load; it has a filesystem scan near the 5000 ms timeout).
- Do not touch .planning/ROADMAP.md (quick task; Phase 11 stays "In Progress"). Do not stage .planning/config.json. Commit EXPLICIT files only (git add <paths>, never -A / .).
- Do not add any "Clear flag"/confirm-flag control, and do not alter audit ordering/atomicity.
</constraints_for_every_task>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: WR-06 certificateEnabled-aware dashboard column + both stale copy lines</name>
  <files>src/server/services/enrolment-dashboard-service.ts, src/components/learner/CertificateSlot.tsx, src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx, tests/enrolment-dashboard-service.test.ts, tests/certificate-slot.test.ts, tests/components/certificate-slot.test.tsx, tests/learner-dashboard-page.test.ts, tests/components/grade-entry-client.test.tsx</files>
  <behavior>
    - deriveCertificateColumn({ certificateEnabled: false, hasCompletionRecord: true, certificate: null }) -> { kind: "not-applicable" } (the WR-06 false promise); same result with hasCompletionRecord false.
    - certificateEnabled false but a certificate row EXISTS (award later switched off): ACTIVE -> issued, ACTIVE flagged -> flagged, REVOKED -> revoked. The flag only suppresses the no-certificate branches; an earned or revoked certificate is never hidden.
    - certificateEnabled true keeps every current result: no cert + record -> pending-issuance; no cert + no record -> not-complete; the three existing-certificate branches unchanged.
    - Service wiring: a COURSE-cohort card reads Course.certificateEnabled of cohort.courseId; a PROGRAMME-cohort card reads Programme.certificateEnabled of cohort.programmeId (D-01: the enrolment's own scope decides, never a member course). A Course with certificateEnabled false + completion record + no certificate -> card.certificate is not-applicable; a Programme cohort whose programme is enabled but whose member Course is disabled still yields pending-issuance. An award row that cannot be found is treated as NOT enabled.
    - No N+1: a two-enrolment dashboard (one COURSE, one PROGRAMME cohort) calls store.course.findMany exactly once and store.programme.findMany exactly once; a dashboard with only course cohorts issues no programme query (skip when the id list is empty), mirroring the existing enrolmentIds.length guard.
    - CertificateSlot: not-applicable renders nothing (container is empty, no "Certificate" title). not-complete renders a normal card (title "Certificate", body "Your certificate will appear here once you have completed all requirements.") with NO "arriving in a future update" text. Every other branch's copy is unchanged verbatim.
    - GradeEntryClient RELEASED state renders exactly "Certificate impact — correcting a released grade flags any active certificate for staff review." (keeps the "Certificate impact" prefix so the DRAFT-state test asserting /Certificate impact/ is absent stays meaningful).
  </behavior>
  <action>
    Decisions made by this plan (per the user's WR-06 ruling): a certificateEnabled=false award with no certificate shows NOTHING (new `not-applicable` CertificateColumn kind, rendered as null), not a neutral card, so a disabled-certificate learner sees no certificate surface at all. certificateEnabled is loaded via the dashboard store slice, batched, never per card.

    RED first (edit tests only, then run and watch them fail):
    1. tests/certificate-slot.test.ts and tests/enrolment-dashboard-service.test.ts: add the deriveCertificateColumn cases from the behavior list; add `certificateEnabled: true` to every EXISTING deriveCertificateColumn call in these two files and in tests/components/certificate-slot.test.tsx (the input field becomes required). In tests/enrolment-dashboard-service.test.ts extend makeDashboardStore/makeService with `course` and `programme` findMany fakes that honour the `in` clause; drive them from a new optional option (e.g. awardCertificateEnabled keyed by course/programme id) that DEFAULTS to enabled=true for any id not listed, so all existing scenarios keep their current expectations; add the wiring scenarios and the once-each spy test using the existing wrapDashboardStore hook (same style as the current no-N+1 test).
    2. tests/components/certificate-slot.test.tsx: replace the not-complete test (new body copy, and assert queryByText(/arriving in a future update/i) is null); add a not-applicable test (render returns an empty container).
    3. tests/learner-dashboard-page.test.ts: the "four named-gap strings" test lists "Certificate — arriving in a future update"; remove ONLY that entry (certificate is no longer a named gap; the other three stay), update the stale comment near the card() fixture, and add a page-level case where card.certificate is { kind: "not-applicable" } and the html contains neither "Certificate" heading text from the slot nor "being finalized".
    4. tests/components/grade-entry-client.test.tsx: change the RELEASED test (~line 124) to the new staff string.
    Run these files RED via powershell/npx vitest and confirm the new/updated cases fail for the expected reasons.

    Then implement (GREEN):
    - enrolment-dashboard-service.ts: add `{ kind: "not-applicable" }` to CertificateColumn and update its doc comment; add `certificateEnabled: boolean` (required) to deriveCertificateColumn's input and, only inside the `!input.certificate` branch, return not-applicable when it is false before consulting hasCompletionRecord; replace the "Out of scope (WR-06 ...)" paragraph with an accurate one (certificateEnabled is now handled; REVOKED+ACTIVE row selection remains a known separate item). Extend EnrolmentDashboardStore with `course: { findMany(args: { where: { id: { in: string[] } }; select: { id: true; certificateEnabled: true } }): Promise<{ id: string; certificateEnabled: boolean }[]> }` and the same for `programme`. In loadLearnerDashboard collect distinct cohort.courseId (for non-programme cohorts) and cohort.programmeId, add the two reads to the existing batched Promise.all (each skipped -> [] when its id list is empty), build a Map keyed by `COURSE:<id>` / `PROGRAMME:<id>`, and pass `certificateEnabled: awardEnabled.get(scopeKey) ?? false` into buildCardContext's certificateContext alongside hasCompletionRecord/certificate (extend that parameter's type). The live prisma binding already satisfies the slice via the existing `prisma as unknown as EnrolmentDashboardStore` cast. Update the file-header "PLAN 11-13" paragraph's query-count sentence to say four batched reads.
    - CertificateSlot.tsx: add the not-applicable early `return null` first (so the tail narrows to issued|flagged); replace the not-complete DeferredSlot with the CARD/TITLE/BODY card using the exact copy in the behavior list; drop the now-unused DeferredSlot import; fix the header comment items 1 (and add the not-applicable line).
    - GradeEntryClient.tsx (~line 258): replace the paragraph text with the exact string in the behavior list. Change nothing else in that component.
    Do not paraphrase the pending-issuance, flagged or revoked copy.
  </action>
  <verify>
    <automated>powershell.exe -NoProfile -Command "npx vitest run tests/enrolment-dashboard-service.test.ts tests/certificate-slot.test.ts tests/components/certificate-slot.test.tsx tests/learner-dashboard-page.test.ts tests/components/grade-entry-client.test.tsx"</automated>
  </verify>
  <done>
    RED run recorded (new cases failed against old code), GREEN run passes for the five files. `grep -rn "arriving in a future update" src/components/learner/CertificateSlot.tsx "src/app/staff/cohorts"` returns nothing; the three Assessments/Results/Support-tickets DeferredSlot strings in dashboard/page.tsx are untouched. deriveCertificateColumn has no caller that omits certificateEnabled (`powershell.exe -NoProfile -Command "npx tsc --noEmit"` clean for the touched files; if the full tsc is slow, run it once at the end of Task 3). Committed with explicit paths: `fix(11): WR-06 hide certificate promise for awards that issue none; replace stale certificate copy`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: WR-05 learner download only for the current ACTIVE certificate</name>
  <files>src/server/services/certificate-service.ts, tests/certificate-service.test.ts, tests/certificate-download.integration.test.ts</files>
  <behavior>
    - Unit (tests/certificate-service.test.ts, existing harness/cert() fixtures): getOwnCertificateForDownload returns null for status SUPERSEDED even for the owner (this is the failing-today case); still null for REVOKED, unknown id, non-owner; still returns the row for ACTIVE and for flagged-but-ACTIVE (UAT test 17).
    - Integration (real Postgres + MinIO, tests/certificate-download.integration.test.ts): after seedIssuedCourseCertificate(), the owner gets the row; after that certificate row is set to SUPERSEDED via testDb.prisma.certificate.update (include whatever revocation columns/constraints the Certificate model requires, read prisma/schema.prisma Certificate — no migrations), getOwnCertificateForDownload({ userId }, id) is null; a separate fixture with reviewFlaggedAt set (still ACTIVE) still returns the row.
  </behavior>
  <action>
    RED first: add the SUPERSEDED unit test, and the two integration cases above (a new `it` after the existing "second learner" case, using the existing seedIssuedCourseCertificate/TEST_DB_TIMEOUT_MS pattern). Run `powershell.exe -NoProfile -Command "npx vitest run tests/certificate-service.test.ts"` and then the integration file for real (`... npx vitest run tests/certificate-download.integration.test.ts`; Docker is up, allow it several minutes, run it as a single file and in the background/with a long timeout, not with other suites). Confirm the SUPERSEDED cases fail because the row is still returned.

    GREEN: in certificate-service.ts change the learner predicate from `row.status === "REVOKED"` to `row.status !== "ACTIVE"` (keep the not-found and owner checks and their order), and rewrite the doc comment above getOwnCertificateForDownload to say it returns null for anything except the owner's current ACTIVE certificate (REVOKED and SUPERSEDED both withdrawn; a flagged-but-ACTIVE one still returns, a flag never withdraws earned access). Do NOT touch src/app/api/certificates/[id]/download/route.ts or the staff/scoped path (certificateService.get / staff download): identical-404 denial parity must stay exactly as is. Also fix the stale word in the file's header list entry 3 if it mentions only REVOKED.

    Then run the tests that exercise this predicate through mocks/other paths and update ONLY assertions that encoded the old behaviour: tests/certificate-revocation.test.ts, tests/certificate-download-route.test.ts (route test mocks the function so it should need no change; if it does, that indicates a parity regression: stop and fix the code, not the test).
  </action>
  <verify>
    <automated>powershell.exe -NoProfile -Command "npx vitest run tests/certificate-service.test.ts tests/certificate-revocation.test.ts tests/certificate-download-route.test.ts"</automated>
  </verify>
  <done>
    RED recorded for the unit and integration SUPERSEDED cases; unit tests green; tests/certificate-download.integration.test.ts run for real against Testcontainers and green (all its cases, including the existing dashboard/G-01 case, which also proves the Task 1 batched course/programme read works against real Prisma with a certificateEnabled=true course). Route file and staff path untouched (`git diff --stat` shows neither). Committed with explicit paths: `fix(11): WR-05 restrict learner certificate download to the current ACTIVE row`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: WR-03 confine template image assetKey to certificate-template-assets/</name>
  <files>src/server/services/certificate-template-layout.ts, tests/certificate-template-layout.test.ts, tests/certificate-template-service.test.ts</files>
  <behavior>
    - Parser accepts: certificate-template-assets/tpl/image, certificate-template-assets/draft/<uuid>, certificate-template-assets/<templateId>/<uuid> (the real shapes buildTemplateAssetStorageKey / finalTemplateAssetKeyFor produce); the existing validLayout fixture and the seeded default layout (no image element) still parse; golden/renderer fixtures using certificate-template-assets/tpl/logo still parse.
    - Parser rejects with UnsupportedCertificateLayoutError (issue text "assetKey", never echoing the key): "", "   ", "submissions/abc", "lessons/x/y", "certificates/<id>/<uuid>", "certificate-template-asset-uploads/tpl/x" (the STAGED prefix is not a final key), "pending-upload", "/certificate-template-assets/tpl/x" (absolute), "certificate-template-assets/../submissions/abc", "certificate-template-assets/tpl/../../x", "certificate-template-assets/" (prefix only), "certificate-template-assets//x", "certificate-template-assets/tpl/./x", keys containing a backslash, and a non-string value. A leading-space variant of a valid key is rejected (prefix check is on the raw string).
    - Service (tests/certificate-template-service.test.ts, existing harness): certificateTemplateService.create with a layout containing an image element whose assetKey is "submissions/abc" rejects with UnsupportedCertificateLayoutError and the delegate's create is never called; update("tpl-1", { layout: <same bad layout> }) rejects and the stored layout is unchanged; positive twins with "certificate-template-assets/tpl-1/<uuid>" persist on create and on update.
  </behavior>
  <action>
    Layer decision (per the review's parse-time + read-time ask): fix it in the PURE PARSER only. certificate-template-service.ts already runs the parser on every create/update (save-time) and certificate-file-service.ts re-parses the stored layout before every render (read-time), so no service or storage-service change is needed and getObjectBytes stays generic. The parser is versioned (schema: 1) but this narrows the accepted VALUE domain of an existing field, not the schema shape, so schema stays 1 (no version bump); consequence to state in the SUMMARY: a previously saved layout with an out-of-domain key will now fail loudly at the render step (already the failure mode for a typo'd key), the seeded default template has no image element, and confirmed uploads always land under certificate-template-assets/ so nothing legitimate regresses. First grep prisma/seed.ts and src for any other image-element literal to confirm this.

    RED first: add the parser cases to tests/certificate-template-layout.test.ts (use it.each for the reject list, keep the existing empty-key test) and the four service cases to tests/certificate-template-service.test.ts (a BAD_IMAGE_LAYOUT constant built from VALID_LAYOUT plus an image element). Run `powershell.exe -NoProfile -Command "npx vitest run tests/certificate-template-layout.test.ts tests/certificate-template-service.test.ts"` and confirm the reject cases fail today (parser accepts any non-empty string) while the accept cases already pass.

    GREEN: in certificate-template-layout.ts, export a constant CERTIFICATE_TEMPLATE_ASSET_KEY_PREFIX = "certificate-template-assets/" (the module must stay pure with NO new imports, so it cannot import storage-service; add a comment that it must equal the prefix storage-service.ts's buildTemplateAssetStorageKey/finalTemplateAssetKeyFor use). In parseImageElement replace the non-empty check with a helper that requires: typeof string; startsWith the prefix; a non-empty remainder; remainder split on "/" has no empty segment and no "." or ".." segment; no backslash and no control characters anywhere. Any violation calls fail("assetKey"). Return the key unchanged (no trimming/normalising, so stored keys round-trip byte-for-byte). Do not change the text/border parsers or RECOGNISED_* lists.

    Final verification for the whole quick task after this task's commit: run (separately, never the whole suite) tests/certificate-pdf-renderer.test.ts, tests/certificate-pdf-positions.test.ts, tests/certificate-file-service.test.ts, tests/certificate-issuance-service.test.ts to prove no fixture used a foreign key; then tests/boundary.test.ts and tests/certificate-phase-invariants.test.ts (invariants alone if it times out); then `powershell.exe -NoProfile -Command "npx tsc --noEmit"` and `powershell.exe -NoProfile -Command "npx eslint <all changed src and test files>"`. Fix anything red that this pass caused; do not widen scope.
  </action>
  <verify>
    <automated>powershell.exe -NoProfile -Command "npx vitest run tests/certificate-template-layout.test.ts tests/certificate-template-service.test.ts tests/certificate-pdf-renderer.test.ts tests/certificate-pdf-positions.test.ts tests/certificate-file-service.test.ts tests/boundary.test.ts"</automated>
  </verify>
  <done>
    RED recorded for the foreign-key rejection cases (parser and service create+update); GREEN for all listed files; tests/certificate-phase-invariants.test.ts green (alone if needed); tsc and eslint clean for touched files. `git diff --stat` shows certificate-template-service.ts, storage-service.ts, certificate-default-template-layout.ts, prisma/seed.ts unchanged. Committed with explicit paths: `fix(11): WR-03 confine certificate template image assetKey to certificate-template-assets/`. Finally write .planning/quick/260919-rxu-phase-11-mini-pass-wr-06-certificate-cop/260919-rxu-SUMMARY.md (RED/GREEN evidence per task, decisions: not-applicable kind, parser-layer choice, missing award row treated as not enabled; note WR-02 accepted, CR-05 still deferred, REVOKED+ACTIVE row-selection half of WR-06 not in this pass) and commit it with the STATE/quick-task bookkeeping the quick workflow prescribes, explicit files only, no ROADMAP.md, no .planning/config.json.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| staff (certificates.manage) -> template layout JSON | Untrusted assetKey string crosses into an object-store read via getObjectBytes at render time |
| learner -> /api/certificates/[id]/download | Owner-supplied certificate id decides which PDF a presigned URL is minted for |
| server -> learner dashboard | Certificate state shown to a learner must not promise something the award will never issue |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-rxu-01 | Information Disclosure | certificate-template-layout.ts parseImageElement -> getObjectBytes | mitigate | Prefix + segment/traversal validation in the pure parser; runs at save (create/update) and at render (certificate-file-service re-parse); rejection message never echoes the key |
| T-rxu-02 | Information Disclosure | getOwnCertificateForDownload | mitigate | Predicate is owner AND status === ACTIVE, so revoked-then-superseded PDFs stop being reachable by their owner; denial stays the identical null -> identical 404 |
| T-rxu-03 | Spoofing/Repudiation | learner dashboard certificate slot | mitigate | certificateEnabled-aware column returns not-applicable instead of a false "being finalized" promise; existing certificates are never hidden by the flag |
| T-rxu-04 | Elevation of Privilege | dashboard certificateEnabled reads | accept | Course/Programme ids come only from the learner's own ownership-scoped enrolments (listOwnDashboardEnrolments); the reads select only id + certificateEnabled |
| T-rxu-05 | Tampering | staff grade-entry copy | accept | Copy-only change, no behaviour or permission change |
| T-rxu-SC | Tampering | package installs | accept | No package installs in this task (constraint); nothing to audit |
</threat_model>

<verification>
- Each task's RED run failed for the stated reason before the production change; GREEN afterwards.
- Files run green: tests/enrolment-dashboard-service.test.ts, tests/learner-dashboard-page.test.ts, tests/certificate-slot.test.ts, tests/components/certificate-slot.test.tsx, tests/components/grade-entry-client.test.tsx, tests/certificate-service.test.ts, tests/certificate-revocation.test.ts, tests/certificate-download-route.test.ts, tests/certificate-template-layout.test.ts, tests/certificate-template-service.test.ts, tests/certificate-download.integration.test.ts (real Docker), tests/boundary.test.ts, tests/certificate-phase-invariants.test.ts.
- No prisma migrate/db push/db execute run; .env DATABASE_URL never used; no installs; ROADMAP.md and .planning/config.json untouched; three (plus summary) commits with explicit paths only.
</verification>

<success_criteria>
- A certificateEnabled=false Course/Programme learner sees no certificate text on their card unless a certificate row exists.
- SUPERSEDED (and REVOKED) certificates are not downloadable by their owner; flagged-but-ACTIVE still is; staff path and 404 parity unchanged.
- Foreign, traversal, absolute, staged-prefix, placeholder and empty asset keys are rejected at template create and update; legitimate keys and the seeded template still parse.
- Both stale "arriving in a future update" certificate lines are gone/accurate; tests updated accordingly.
</success_criteria>

<output>
Create `.planning/quick/260919-rxu-phase-11-mini-pass-wr-06-certificate-cop/260919-rxu-SUMMARY.md` when done
</output>

<source_audit>
GOAL/scope items from the task spec: (1) WR-06 + both copy lines -> Task 1; (2) WR-05 -> Task 2; (3) WR-03 incl. create AND update test -> Task 3; WR-02 accepted and CR-05 deferred -> explicitly untouched (constraints_for_every_task). Locked decisions honoured: D-01 programme-scope rule (award and completion keyed by the enrolment's own scope), no Clear-flag control, flagged-but-ACTIVE download preserved (UAT 17). No RESEARCH.md (quick, no research). Not planned by design: WR-06's REVOKED+ACTIVE row-selection half (not in the user's fix list; documented as remaining in code comment and SUMMARY).
</source_audit>
