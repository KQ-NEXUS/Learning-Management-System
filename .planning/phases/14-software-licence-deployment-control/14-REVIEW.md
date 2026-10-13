---
phase: 14-software-licence-deployment-control
reviewed: 2026-10-02T00:00:00Z
depth: standard
files_reviewed: 100
files_reviewed_list:
  - .dockerignore
  - netlify/functions/check-licence.ts
  - prisma/migrations/20261001120000_licence_deployment_control/migration.sql
  - prisma/schema.prisma
  - provider-tools/licence-issuer/cli.ts
  - provider-tools/licence-issuer/issue.ts
  - provider-tools/licence-issuer/README.md
  - provider-tools/licence-issuer/RUNBOOK.md
  - src/app/(auth)/register/actions.ts
  - src/app/(checkout)/actions.ts
  - src/app/(checkout)/checkout/[orderId]/actions.ts
  - src/app/(checkout)/enrol/[cohortId]/page.tsx
  - src/app/(public)/CheckoutNotice.tsx
  - src/app/api/lesson-resources/[id]/complete/route.ts
  - src/app/api/lesson-resources/[id]/route.ts
  - src/app/api/lesson-resources/route.ts
  - src/app/api/lesson-resources/upload-intent/route.ts
  - src/app/api/staff/licence/diagnostic/route.ts
  - src/app/staff/StaffShell.tsx
  - src/app/staff/layout.tsx
  - src/app/staff/licence/ActivateLicenceForm.tsx
  - src/app/staff/licence/CopyButton.tsx
  - src/app/staff/licence/DiagnosticDownloadButton.tsx
  - src/app/staff/licence/LicenceStatusView.tsx
  - src/app/staff/licence/actions.ts
  - src/app/staff/licence/loading.tsx
  - src/app/staff/licence/page.tsx
  - src/app/staff/roles/actions.ts
  - src/app/staff/users/AssignmentsPanel.tsx
  - src/app/staff/users/actions.ts
  - src/components/licence/LicenceBanner.tsx
  - src/components/licence/LicenceRefusalNote.tsx
  - src/components/licence/LicenceRestrictionProvider.tsx
  - src/components/primitives/ConfirmModal.tsx
  - src/components/primitives/ResourceForm.tsx
  - src/instrumentation.ts
  - src/server/communications/contracts.ts
  - src/server/communications/links.ts
  - src/server/communications/notification-text.ts
  - src/server/email/templates/staff-templates.ts
  - src/server/licence/clock.ts
  - src/server/licence/constants.ts
  - src/server/licence/display.ts
  - src/server/licence/effects.ts
  - src/server/licence/errors.ts
  - src/server/licence/format.ts
  - src/server/licence/policy.ts
  - src/server/licence/registry.ts
  - src/server/licence/state.ts
  - src/server/licence/trust-set.ts
  - src/server/licence/types.ts
  - src/server/licence/verify.ts
  - src/server/licence/view-model.ts
  - src/server/permissions/catalogue.ts
  - src/server/permissions/index.ts
  - src/server/permissions/refusal.ts
  - src/server/permissions/with-permission.ts
  - src/server/scheduled/check-licence-task.ts
  - src/server/services/checkout-service.ts
  - src/server/services/checkout-webhook-system-service.ts
  - src/server/services/domain-event-service.ts
  - src/server/services/email-delivery-log-service.ts
  - src/server/services/event-intent-mappers.ts
  - src/server/services/event-mappers/licence.ts
  - src/server/services/event-mappers/staff.ts
  - src/server/services/lesson-progress-service.ts
  - src/server/services/licence-activation-service.ts
  - src/server/services/licence-notice-service.ts
  - src/server/services/licence-service.ts
  - src/server/services/licence-staff-service.ts
  - src/server/services/licence-startup-service.ts
  - src/server/services/notification-access-service.ts
  - src/server/services/registration-service.ts
  - src/server/services/staff-account-service.ts
  - src/app/staff/certificates/CertificateQueueTable.tsx
  - src/app/staff/certificates/issued/[id]/CertificateRecordActions.tsx
  - src/app/staff/certificates/templates/TemplateEditorShell.tsx
  - src/app/staff/certificates/templates/template-actions.ts
  - src/app/staff/certificates/templates/template-asset-actions.ts
  - src/app/staff/cohorts/[id]/enrolment-actions.ts
  - src/app/staff/cohorts/[id]/instructor-actions.ts
  - src/app/staff/cohorts/[id]/publish-actions.ts
  - src/app/staff/cohorts/[id]/session-actions.ts
  - src/app/staff/cohorts/actions.ts
  - src/app/staff/courses/[id]/arrange/actions.ts
  - src/app/staff/courses/[id]/assessments/actions.ts
  - src/app/staff/courses/[id]/assessments/question-actions.ts
  - src/app/staff/courses/[id]/lessons/[lessonId]/actions.ts
  - src/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient.tsx
  - src/app/staff/courses/[id]/publish-actions.ts
  - src/app/staff/courses/actions.ts
  - src/app/staff/programmes/[id]/arrange/actions.ts
  - src/app/staff/programmes/[id]/publish-actions.ts
  - src/app/staff/programmes/actions.ts
  - src/app/staff/email-log/EmailLogTable.tsx
  - src/app/staff/cohorts/[id]/grading/[assessmentId]/GradingQueueTable.tsx
  - src/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/GradeEntryClient.tsx
  - src/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel.tsx
  - src/app/staff/cohorts/[id]/sessions/[sessionId]/attendance/AttendanceMarkClient.tsx
  - src/components/catalogue/UnsavedOrderGuard.tsx
findings:
  critical: 0
  warning: 8
  info: 9
  total: 17
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-10-02
**Depth:** standard
**Files Reviewed:** 100
**Status:** issues_found

## Summary

The licence module is carefully built and I could not find a way to forge a licence, bypass the signature check, or reach the write gate from an unauthorised caller. The verifier pins the algorithm, looks the key up by `kid` in a closed trust set, checks the signature over the exact ASCII bytes, and only then parses the payload. The activation transaction takes `SELECT ... FOR UPDATE` on the singleton row before reading and then writes under a version guard. `withPermission` runs the licence guard strictly after the grant check, so a denied caller never reaches it. The `LicenceRestrictedError` surface is only reachable by an authorised caller. Every guarded write entry point I traced (checkout x3, registration, webhook cutoff, lesson-resource routes, server actions) is either guarded or documented in the registry as continuity/system. No private-key material is committed or printed.

No CRITICAL (BLOCKER) issue was found. The findings below are robustness and correctness gaps, mostly in edge behaviour: one fail-closed path that contradicts the OQ1 decision, two activation-recovery traps, one pre-existing crash that the new restricted-mode redirect now routes users into, and provider-tool hardening gaps.

Reviewed and found sound (not findings): wrong-algorithm/`alg` confusion (literal `Ed25519`), `kid` regex plus Map lookup, revoked-key ordering, signature-before-payload-parse, 8192-char and alphabet pre-checks, `notBefore` evaluated only in activate mode, clock never taken from the stored high-water mark, single-winner CAS for transitions, activation lock/rollback sentinel, authorization-before-guard ordering, no state oracle for denied callers (status page, diagnostic route, actions and lesson-resource routes all return the same denial in every licence state), allow-listed snapshot and diagnostic DTOs, notice payloads built field by field, `.dockerignore` exclusion of `provider-tools`.

## Warnings

### WR-01: Read-failure branch fails closed after 24 hours even for a deployment that never activated a licence

**File:** `src/server/services/licence-service.ts:810-834` (called from `checkWriteGate`, 849-855)
**Issue:** `decideDuringReadFailure` blocks every guarded write once `degradedSince` is 24 hours old, regardless of whether a licence was ever activated. When the licence tables cannot be read (the migration has not been applied to a database the new code is pointed at, a permissions problem on the new tables, a partial restore) and `lastGood` is null, the process allows writes for exactly 24 hours and then returns `INVALID / VALIDATION_WINDOW_EXHAUSTED` for all write-class operations, including checkout and registration. That contradicts the owner decision OQ1 option-a ("a deployment that has never activated is fully operational, never restricted"). In a long-lived Docker process the whole product's writes die one day after deploying the code ahead of the migration. The same branch is also fail-open in the opposite direction: `lastGood` is per process, so on a restart (or a new serverless instance) of a deployment that was restricted, writes are allowed again until the 24-hour window runs out.
**Fix:** Separate "never saw a good read in this process" from "saw a restricted state". When `lastGood === null`, either (a) keep allowing and do not start the exhaustion clock, or (b) probe once whether the licence tables exist and treat a missing table as UNLICENSED. Example for (a):
```ts
if (lastGood === null) return { allowed: true }; // no known restriction to preserve; OQ1 says unlicensed is open
degradedSince ??= at;
if (at.getTime() - degradedSince.getTime() >= UNAVAILABLE_WINDOW_MS) { ... }
```
If persistence across restarts matters for the restricted case, store the last-known-good flag somewhere that survives a restart (it must not be the licence tables).

### WR-02: Re-uploading the active licence file cannot recover a stored record that fails verification

**File:** `src/server/services/licence-service.ts:337-339`
**Issue:** `assessActivation` returns `ALREADY_ACTIVE` whenever the submitted `licenceId` equals the stored record's `licenceId`, without checking that the stored record still verifies. Derivation (`computeDerived`) rejects a stored record whose raw text no longer verifies (BAD_SIGNATURE for a column/payload mismatch, or any later rejection) and puts the deployment into INVALID, restricted. The only recovery route the UI offers is activation, and activating the original, correct file is answered "This licence is already active. No change was made" while the deployment stays restricted. Recovery then requires the provider to issue a new file with a newer `issuedAt`.
**Fix:** Treat the file as already active only when the stored record is healthy and the text matches. Compute the current evaluation inside the locked transaction and let a same-`licenceId` upload through when the active record fails verification:
```ts
if (rows.record !== null && licence.licenceId === rows.record.licenceId &&
    licence.raw === rows.record.raw && storedRecordVerifies) {
  return { ok: false, code: "ALREADY_ACTIVE" };
}
```
(`storedRecordVerifies` comes from `computeDerived(rows, now, trustSet).verified !== null`; the same-id insert must then become an UPDATE of the record, or the unique `licenceId` index will reject it.)

### WR-03: A licence with a future `issuedAt` permanently blocks every later licence

**File:** `src/server/services/licence-service.ts:344-350` (anti-replay A7); `provider-tools/licence-issuer/issue.ts:158-205`
**Issue:** The anti-replay rule rejects any licence whose `issuedAt` is not newer than the greatest recorded one. Nothing bounds `issuedAt` above: the verifier only checks `issuedAt <= expiresAt`, and activation enforces `notBefore`, not `issuedAt`. A licence signed with a mistaken far-future `issuedAt` (typo, wrong year, the runbook's "prepare in advance" advice combined with an explicit `--not-before` earlier than `--issued`) activates today, and from then on every correctly dated renewal is refused as `OLDER_THAN_ACTIVE`. `LicenceRecord` is append-only and no application path deletes it, so there is no in-product recovery.
**Fix:** In `assessActivation`, reject an `issuedAt` later than `now + SKEW_TOLERANCE_MS` (a new closed code, or reuse `NOT_YET_VALID`). In the issuer, refuse or loudly warn when `--issued` is in the future, and when `notBefore < issuedAt`:
```ts
if (licence.issuedAt.getTime() > now.getTime() + SKEW_TOLERANCE_MS) return { ok: false, code: "NOT_YET_VALID" };
```

### WR-04: `CheckoutNotice` uses the `in` operator on a plain object, so `?notice=__proto__` crashes the page

**File:** `src/app/(public)/CheckoutNotice.tsx:31`
**Issue:** `!(notice in NOTICES)` is true for inherited keys. `?notice=__proto__` makes `NOTICES[notice]` the `Object.prototype` object, which React refuses as a child ("Objects are not valid as a React child"), so `/courses` and `/courses/[slug]` throw a 500 for that URL; `constructor`, `toString` and `valueOf` render a function child (React warning, nothing shown). The comment above the constant claims "the query can never inject text". The `in` check is pre-existing, but this phase now routes every restricted-mode checkout and payment refusal to `/courses?notice=unavailable`, so this component is part of the restricted-mode learner path.
**Fix:**
```ts
if (typeof notice !== "string" || !Object.hasOwn(NOTICES, notice)) return null;
```

### WR-05: `ConfirmModal` and `ResourceForm` pull the whole licence policy module (copy, zod schemas) into learner and public client bundles

**File:** `src/components/primitives/ConfirmModal.tsx:6`, `src/components/primitives/ResourceForm.tsx:13` (importing `src/server/licence/policy.ts`, which imports `format.ts` and zod)
**Issue:** Both client primitives import `isLicenceRefusalMessage` from `policy.ts` just to compare one string. `policy.ts` carries every licence sentence ("Restricted continuity mode", rejection sentences, notice copy, `format.ts`'s envelope schemas) and `ConfirmModal` is used by learner and public surfaces (`QuizAttemptPanel`, `UnsavedOrderGuard`, `LearnerTicketDetail`). The licence wording and the published contract schema therefore ship to non-holders and learners, against the intent of P2 ("no licence wording reaches learners") and T-14-19-01. It is static copy, not state, but a bundle grep for "Restricted continuity mode" on a learner route now matches, and `zod` plus the format module are added to those bundles for no reason.
**Fix:** Move `LICENCE_REFUSAL_MESSAGE` and `isLicenceRefusalMessage` into a tiny dependency-free module (for example `src/server/licence/refusal-message.ts`), import that from the primitives and from `policy.ts`, and add a bundle test that learner entry points do not contain the other licence strings.

### WR-06: The provider signing key is written as an unencrypted PEM and the `0600` mode is not effective on Windows

**File:** `provider-tools/licence-issuer/issue.ts:104-107`, `:119-126`
**Issue:** `privateKey.export({ type: "pkcs8", format: "pem" })` has no cipher or passphrase, so the file that can mint unlimited licences (and, per the runbook, cannot be revoked without a client release) sits on disk readable by anyone with file access. `mode: 0o600` is only honoured on POSIX; the repo's working environment and README example paths are Windows (`D:/provider-vault/...`), where the file inherits directory ACLs. `loadPrivateKey` has no passphrase support, so adding encryption later is a breaking change to the tool.
**Fix:** Offer an encrypted key by default: `export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase })` with the passphrase read from a prompt or `LICENCE_KEY_PASSPHRASE` (never an argument), and `createPrivateKey({ key, passphrase })` on load. Document an ACL step for Windows in the runbook, or refuse to write unless the target directory is owner-only.

### WR-07: `issueLicence` never verifies its own output, so a `kid` that does not match the signing key ships an unverifiable licence

**File:** `provider-tools/licence-issuer/issue.ts:158-205`, `provider-tools/licence-issuer/cli.ts:123-143`
**Issue:** The issuer signs with whatever key `--key` points to and writes whatever `--kid` says. A wrong `--kid` (or a key from another generation) produces a well-formed file that every client rejects as `UNKNOWN_KEY` or `BAD_SIGNATURE`; the runbook relies on a manual `verify` step. The CLI also writes the file before anything is checked, and the same tool enforces nothing about `deploymentId` shape (any 1 to 100 identifier characters) or about reuse of a `licenceId` already issued.
**Fix:** After signing, derive the public key from the private key and run `verifyLicence` in activate mode against a trust set built from it (same module the client uses) before returning; throw if it does not verify. Optionally keep a local issued-register file and refuse a repeated `licenceId`.

### WR-08: Development trust keys are trusted whenever `NODE_ENV` is anything other than the string `production`

**File:** `src/server/licence/trust-set.ts:63-70`
**Issue:** The posture is default-open: an unset, misspelt or non-standard `NODE_ENV` (for example a Netlify function runtime or a container started with `node` directly) silently adds three dev keys to the trust set, and the app process and the scheduled function can disagree about the trust set if their `NODE_ENV` differs. Today the private halves do not exist, so this is not exploitable, but the safety rests on an environment variable's default rather than on an explicit opt-in, and the trust-set comment itself calls the control "a speed bump".
**Fix:** Invert the default: include `DEV_TRUSTED_KEYS` only when `NODE_ENV === "development"` or `"test"` (or an explicit `LICENCE_ALLOW_DEV_KEYS=1`), and log once at startup which trust set was chosen.

## Info

### IN-01: Header JSON is parsed before the signature is verified, contrary to the published contract text

**File:** `src/server/licence/verify.ts:86-94` (contract: `src/server/licence/format.ts:5-9`, 14-14-DECISIONS D-02)
**Issue:** D-02 and the `format.ts` header say the signature is verified "before any JSON parsing". The header must be decoded and parsed first to read `kid`. The input is bounded (8192 characters), `alg` is a literal, and nothing from the header is trusted beyond key lookup, so this is not a vulnerability, but a second implementation following the written contract literally cannot be built.
**Fix:** Reword the contract and comments: "the payload is parsed only after the signature verifies; the header is parsed first, bounded, to select the key and pin the algorithm."

### IN-02: `inspect` prints unverified file contents to the terminal unescaped

**File:** `provider-tools/licence-issuer/cli.ts:196-207`
**Issue:** `inspect` echoes `kid`, `licenceId`, client name, deployment id and dates taken from an unsigned, attacker-supplied payload with `String(...)`. A file crafted to contain ANSI escape sequences in those strings can rewrite the operator's terminal output (spoof an "OK" line). The envelope alphabet check only restricts the outer text, not the decoded JSON.
**Fix:** Print with `JSON.stringify(value)` or strip control characters (`/[\u0000-\u001f\u007f-\u009f]/g`) before display.

### IN-03: A holder of `licence.activate` without `licence.view` still learns licence detail

**File:** `src/server/services/licence-service.ts:899-905` and `src/app/staff/licence/actions.ts:126-143, 159`
**Issue:** `inspect` returns `preview.replaces` (the currently active licence id and expiry), the rejection codes (`ALREADY_ACTIVE`, `OLDER_THAN_ACTIVE`, `WRONG_CLIENT`), and activation returns the new state label. A custom role holding only `licence.activate` therefore sees detail the page gates behind `licence.view`. The Administrator holds both (OQ3), so there is no default exposure.
**Fix:** Either document that `licence.activate` implies read access to those fields, or omit `replaces` and collapse client/deployment-binding rejection detail for callers without `licence.view`.

### IN-04: `failureFromError` shows the "needs the activate-licence permission" note for an expired session

**File:** `src/app/staff/licence/actions.ts:99-103`
**Issue:** `AuthenticationError` (signed out) and `AuthorizationError` both map to `NOT_PERMITTED` with `ACTIVATION_PERMISSION_NOTE`. A user whose session expired while the confirm dialog was open is told they lack a permission.
**Fix:** Map `AuthenticationError` to a separate "Your session ended. Sign in again." result.

### IN-05: `CopyButton` never leaves the "Copied" state

**File:** `src/app/staff/licence/CopyButton.tsx:14-22`
**Issue:** `copied` is set true and never reset, so the icon stays a check mark and a second click does not change the live region, so assistive technology is not told again.
**Fix:** Reset with a timeout (`setTimeout(() => setCopied(false), 2000)`, cleared on unmount).

### IN-06: Registration's restricted early return breaks the documented cost symmetry

**File:** `src/server/services/registration-service.ts:164-175` (versus the "Cost symmetry" comment at 177)
**Issue:** The licence refusal returns before the password hash, so a restricted deployment answers registrations measurably faster than an unrestricted one. It does not depend on the email address (no enumeration), and the refusal sentence already discloses the state, so this is cosmetic, but the comment claiming every post-validation path pays the same cost is now false.
**Fix:** Update the comment, or hash first if timing equality is wanted.

### IN-07: A licence refusal alone does not move focus in `ResourceForm`

**File:** `src/components/primitives/ResourceForm.tsx:150-155`
**Issue:** Focus moves to the error summary when `errors.length > 0`, but a licence-refusal-only error list renders the `role="status"` note and no summary element, so `summaryRef.current` is null and focus stays on the submit button. Keyboard and screen-reader users get only a polite announcement after a failed submit.
**Fix:** Give `LicenceRefusalNote` a ref/`tabIndex={-1}` and focus it when `summaryErrors.length === 0 && refusalErrors.length > 0`.

### IN-08: Small input-hygiene inconsistencies in the activation form and decoder

**File:** `src/app/staff/licence/ActivateLicenceForm.tsx:108`; `src/server/licence/format.ts:69-74`
**Issue:** The file size check compares bytes to `MAX_LICENCE_FILE_CHARS` before trimming, so a maximum-length licence with a trailing newline (8193 bytes) is rejected by the browser although the server would accept it. `base64UrlDecode` accepts non-canonical trailing bits, so two different texts can decode to the same signature bytes; harmless because activation dedupes on `licenceId`, but the stored `raw` is not canonical.
**Fix:** Compare after `trim()` (or allow +2 bytes); optionally re-encode and compare in `base64UrlDecode` to enforce canonical form.

### IN-09: The gate awaits the opportunistic transition write before returning its decision, and marks an audit as written before it is

**File:** `src/server/services/licence-service.ts:864-870`, `:641-649`
**Issue:** `checkWriteGate` awaits `evaluateAndRecord` (a transaction on the singleton row) before returning, so while an activation holds `FOR UPDATE` (up to the 15 s transaction timeout) every guarded write that sees a stale stored state waits on that lock even though its decision is already computed. Separately, `recordEnforcement` stores the coalescing timestamp before the audit insert, so a transient audit failure suppresses that actor's denial row for a full minute.
**Fix:** Compute the decision, then run the transition record without blocking the response (`void evaluateAndRecord(...).catch(log)`), or bound it with a short timeout. Set the coalescing marker only after the audit call succeeds.

---

_Reviewed: 2026-10-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
