---
phase: 14-software-licence-deployment-control
verified: 2026-10-02T05:20:00Z
status: human_needed
score: 4/4 roadmap success criteria verified (8/8 requirement IDs satisfied in code)
behavior_unverified: 0
overrides_applied: 0
re_verification: false
gaps: []
deferred: []
coincidental_reliance_items: []
human_verification:
  - test: "Apply migration 20261001120000_licence_deployment_control to the shared Neon database BEFORE (or in the same release as) deploying this code"
    expected: "DeploymentIdentity and LicenceState singletons exist (state UNLICENSED, everActivated false); /staff/licence loads and shows the deployment ID"
    why_human: "The migration is proven only on Testcontainers. The owner forbids touching the shared DB from agents. Order matters: see advisory WR-01 (code live without the tables fails guarded writes closed after 24 h)."
  - test: "Provider custody and embedding of the production signing key: run the provider tool keygen, keep the private key offline, add the PUBLIC key (kid + x) to PRODUCTION_TRUSTED_KEYS in src/server/licence/trust-set.ts in a release, then issue and activate one real licence in production"
    expected: "A production licence signed with the provider key activates; a dev-key licence is rejected (UNKNOWN_KEY) because NODE_ENV is production"
    why_human: "PRODUCTION_TRUSTED_KEYS is intentionally an empty array in the repository, so no licence can be activated in a production build until the provider adds the key. Key custody (and the unencrypted-PEM caveat in WR-06) is an operational decision."
  - test: "Netlify scheduled run: confirm check-licence shows a Scheduled badge (0 * * * *), the log starts with '[scheduled] licence check: state=', and Last verification on /staff/licence advances (steps in docs/deployment/netlify-scheduled-functions.md)"
    expected: "Hourly evaluation runs, transitions are audited once, licence.notice events are emitted and drained into notifications and emails"
    why_human: "Needs the deployed host. On a Docker Compose host there is no scheduler in this repo, so notices and transition audit rows depend on guarded writes or the best-effort startup hook (OQ5/A3, accepted)."
  - test: "Browser walkthrough of Licence and System Status, the staff banner, disabled write controls with the refusal note, the two-step activation dialog, the diagnostic download, and the learner-side neutral copy (new registration and checkout refusal) in a restricted deployment; check keyboard and screen-reader behaviour"
    expected: "Matches 14-UI-SPEC; no licence wording on learner screens; no signing material anywhere; focus and live-region behaviour acceptable (see IN-05, IN-07)"
    why_human: "Visual and accessibility behaviour cannot be confirmed from code."
  - test: "Owner follow-ups from 14-PRD-AMENDMENT.md: regenerate the .docx twins of the PRD and PXR, align the signed commercial contract wording with restricted continuity mode, and place the amended PRD and PXR under version control (they are gitignored)"
    expected: "Documents and contract agree with the implemented restricted continuity mode"
    why_human: "Off-repository documents and legal wording."
---

# Phase 14: Software Licence and Deployment Control Verification Report

**Phase goal:** The deployment enforces its own commercial licence terms without ever risking client data.
**Verified:** 2026-10-02
**Status:** human_needed (no code gaps; human-only items remain)
**Re-verification:** No, initial verification (the previous attempt was cut off before writing anything)

## How this was verified

| Proof | Source |
| --- | --- |
| Source code of the verifier, state machine, trust set, licence service, activation service, staff service, actions, page, layout, permission choke point, effect map, startup service, scheduled task, Netlify function, notice service, mapper, migration | Read directly in this session |
| Static scans: no `provider-tools` import under `src` or `netlify`; no network call (`fetch`, `http(s).request`, axios) in `src/server/licence` or the licence services; no `BEGIN PRIVATE KEY` anywhere outside `node_modules`; no row deletion in licence code, migration or provider tools; `provider-tools` listed in `.dockerignore` | Re-run in this session |
| Unit tests `licence-verify`, `licence-state`, `licence-policy`, `with-permission`, `licence-guard` (5 files, 125 tests) and `licence-service`, `licence-effects`, `check-licence-task`, `licence-staff-service` (4 files, 42 tests) with `--project node` | Re-run in this session, all passed |
| Real-Postgres integration proofs (`licence-schema`, `licence-activation`, `licence-gate`, `licence-evaluate`, `licence-guard`, `licence-payments`, `licence-drain`, `licence-restricted`, `licence-audit`) | NOT re-run here (memory and Docker constraints). Relied on the plan SUMMARY records plus the owner's statement that every plan's tests were re-run and passed. Code paths they exercise were read and are consistent with the claims. |
| Whole-tree scan tests (`licence-enforcement-boundary`, wording, purity, ui-mirror) | NOT re-run (memory). Relied on summaries. The registry design they enforce was read in `registry.ts` and the guard call sites were grepped. |

## Observable truths (roadmap contract)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | The LMS verifies a provider-signed licence at startup, on a schedule and before high-impact mutations, rejecting altered, expired, wrong-client and wrong-deployment licences (LIC-01, LIC-04) | VERIFIED | `verify.ts`: closed `kid` trust-set lookup, revoked-key rejection, Ed25519 signature over the exact ASCII bytes before the payload is parsed, `WRONG_DEPLOYMENT` against the database-seeded id, `WRONG_CLIENT` against the pinned client, `NOT_YET_VALID` in activate mode; `assessActivation` adds `EXPIRED`, `ALREADY_ACTIVE`, anti-replay `OLDER_THAN_ACTIVE`. `computeDerived` re-verifies the stored raw text on every derivation, so editing the stored text or date columns changes nothing (dates come from the signed payload, a licenceId mismatch is `BAD_SIGNATURE`). Three check moments are wired: `instrumentation.ts` -> `runStartupLicenceCheck` (3 s bound, never throws); hourly Netlify function `schedule: "0 * * * *"` -> `runCheckLicenceTask` -> `evaluateAndRecord`; per write, `withPermission` -> `licenceService.checkWriteGate` plus explicit `assertWriteAllowed` in checkout (x3) and registration. Verification is local only (no network code found). Bounded offline policy: D-04 24 h window in `deriveState` (`VALIDATION_ATTENTION` then `INVALID/VALIDATION_WINDOW_EXHAUSTED`). Unit tests pass (re-run). |
| 2 | `licence.view` holders see state, licence ID, client, dates and validation result without signing secrets; only `licence.activate` can activate; nothing can forge or self-extend a licence (LIC-02, LIC-03) | VERIFIED | `licence-staff-service.ts`: status read via `withPermission("licence.view")`, inspect and activate via `withPermission("licence.activate", ..., {licence:"continuity"})`; both permissions are Global-only (`GLOBAL_ONLY_PERMISSIONS`). Authorization runs before the licence guard, so non-holders get the identical `AuthorizationError` in every state. `buildStatusSnapshot` and `buildDiagnosticReport` are field-by-field allow-lists (no raw text, signature or key material; diagnostic lists key IDs only). `page.tsx` renders only the view-model; actions re-authorize behind the form, validate size and alphabet, and map errors to fixed sentences. No UI path or service creates, extends or edits a licence; the only writer of `LicenceRecord` is the activation transaction, which requires a verifier-approved licence. Private key is not in the repo and the issuer lives in `provider-tools/` (Docker-excluded, not imported by `src`/`netlify`). Seeded Administrator keeps `licence.activate` (OQ3, accepted). |
| 3 | On the expiry/grace threshold the system enforces restricted continuity mode server-side and in the UI without deleting client data (LIC-05, LIC-08) | VERIFIED | `deriveState`: `graceEndsAt - now <= 0` gives `RESTRICTED_CONTINUITY` (exact signed instant, ms precision, no calendar arithmetic); restriction is derived on every guarded write, with no scheduler dependency. Server enforcement lives in the single `withPermission` choke point (write-effect permissions refused with `LicenceRestrictedError`; `effectForPermission` defaults unknown permissions to write; total `Record<Permission, effect>`), plus explicit guards on checkout and registration and the four lesson-resource routes (403 with the fixed sentence). Continuity (grading, attendance, certificates, refunds, webhooks, exports, support, activation) is explicitly classified so recovery is never blockable. Webhooks use `getRestrictionCutoff` so in-flight payments complete. UI mirror: staff layout supplies `LicenceRestrictionProvider` and `LicenceBanner`; `ResourceForm` and `ConfirmModal` disable write controls (a courtesy; the server is the control). LIC-08: no delete path in licence code, migration (additive tables only) or provider tools; restriction is application-level, never a database-wide switch. Boundary and real-DB proofs (`licence-enforcement-boundary`, `licence-restricted`, `licence-guard` integration, 13 write / 14 read / 10 continuity) relied on from summaries and the owner re-run. |
| 4 | Every licence event is audited and triggers the appropriate Administrator notification (LIC-06, LIC-07) | VERIFIED | Audit actions written in code: `licence.activated` (inside the activation transaction, atomic with the record and state), `licence.activation_rejected`, `licence.verified` (outcome changes), `licence.state_changed`, `licence.clock_rollback` (both inside the single-winner version-guarded transition transaction), `licence.restriction_enforced` (coalesced per actor per minute, A14), `licence.diagnostic_downloaded` (a failed audit fails the download). Notices: `dueNoticeKeys` -> `licenceNoticeService.emitNotices` -> deterministic id `licence:{id}:{key}` through `writeDomainEventOnce` (deduplicated) -> registered `licence.notice` mapper -> one notification per Global `licence.view` holder plus staff email (except `expiring-60`); payload is allow-listed field by field (no signing, contract or deployment detail, P5). Keys cover expiring buckets, expired, grace-ending, restricted, invalid-{code}, validation-attention, clock rollback. Real-DB proofs (`licence-audit`, `licence-drain`, `licence-evaluate`) relied on. |

**Score:** 4/4 roadmap criteria verified. `behavior_unverified`: 0. State-transition and concurrency truths (row-lock activation, version-guarded CAS, exactly one audit winner, rollback on stale write) are exercised by the real-Postgres integration tests, which the owner re-ran and which I did not re-run.

## Requirements coverage (PLAN frontmatter vs REQUIREMENTS.md)

All eight IDs appear in the plan frontmatter, and REQUIREMENTS.md lists all eight as Phase 14 / Complete. No orphaned requirement.

| Requirement | Plans claiming it | Status | Evidence |
| --- | --- | --- | --- |
| LIC-01 verify signed licence, reject invalid | 01, 02, 03, 04, 05, 07 | SATISFIED | `verify.ts`, `format.ts`, `trust-set.ts`, `assessActivation`; provider tool in `provider-tools/licence-issuer` |
| LIC-02 status screen for `licence.view`, no secrets | 06, 10, 15, 19 | SATISFIED | `page.tsx`, `view-model.ts`, allow-listed snapshot and diagnostic DTOs |
| LIC-03 only `licence.activate` activates; no create/extend UI | 07, 10, 15 | SATISFIED | staff service wrappers, Global-only permission, no write UI beyond activation |
| LIC-04 startup, scheduled, pre-mutation checks; bounded offline policy and warning | 03, 04, 09, 16 | SATISFIED (see advisory WR-01) | `instrumentation.ts`, `check-licence.ts`, `checkWriteGate`, D-04 window, validation-attention notice |
| LIC-05 restricted continuity mode server-side and in UI | 01, 04, 06, 07, 09, 11, 12, 13, 17, 18, 19, 20, 21 | SATISFIED | `deriveState`, `withPermission` guard, service guards, route guards, UI mirror |
| LIC-06 audit of activation, validation, transition, enforcement, export | 07, 09, 11, 15, 21 | SATISFIED | audit actions listed under truth 4 |
| LIC-07 Administrator notifications, deduplicated | 06, 08, 14, 16 | SATISFIED | notice service, mapper, deterministic event ids |
| LIC-08 records preserved, export route kept | 12, 13, 17, 20, 21 | SATISFIED | no deletes; `reports.export` and `audit.export` classified continuity; PRD amendment recorded |

## Required artifacts and key links

| Artifact or link | Status | Notes |
| --- | --- | --- |
| `src/server/licence/{verify,format,trust-set,state,effects,policy,registry,clock,display,view-model}.ts` | VERIFIED (exists, substantive, wired) | Read in full or in relevant part |
| `src/server/services/licence-{service,activation-service,staff-service,notice-service,startup-service}.ts` | VERIFIED | Wired from `permissions/index.ts`, actions, instrumentation, scheduled task |
| `prisma/migrations/20261001120000_licence_deployment_control/migration.sql` | VERIFIED in code; NOT applied to shared DB (accepted, human item) | Additive tables, singleton and state CHECKs, seeded singletons with OQ1 defaults |
| `permissions/index.ts` -> `licenceService.checkWriteGate` | WIRED | Live `withPermission` carries the licence dep |
| `checkout-service.ts`, `registration-service.ts`, `checkout-webhook-system-service.ts` -> `licence: licenceService` | WIRED | Optional-chained guard is bound at the wired singletons (lines 1016, 290, 1441) |
| `netlify/functions/check-licence.ts` -> `check-licence-task.ts` -> `evaluateAndRecord` + `emitNotices` | WIRED | Hourly schedule declared |
| `licence.notice` mapper group registered in `event-intent-mappers.ts` | WIRED | Line 183 |
| Data flow (Level 4) | FLOWING | Status page and banner read the database-derived snapshot; no static fallback found |

## Anti-patterns

A grep for TBD, FIXME and XXX across the licence modules, services, staff licence UI, components, provider tools, scheduled task, Netlify function, instrumentation and diagnostic route found none. The review (0 critical) and my reads found no stubs, empty handlers or hardcoded-empty data in the licence path. The deliberate empty `PRODUCTION_TRUSTED_KEYS` is documented design, not a stub (human item 2).

## Assessment of 14-REVIEW.md warnings

None of the 8 warnings is a goal-blocking gap; all are advisory. The two the owner asked about:

- **WR-01 (read-failure branch fails closed after 24 h even when never activated): ADVISORY, recommend fixing before release.** Confirmed in `decideDuringReadFailure`: with `lastGood === null` the 24 h exhaustion clock still runs and then returns `INVALID/VALIDATION_WINDOW_EXHAUSTED`, which contradicts OQ1 option-a in that edge. It only triggers when the licence tables cannot be read while the rest of the app can (code deployed ahead of the migration, a permissions fault, a partial restore). It blocks writes only; it deletes nothing and reads and continuity operations are unaffected, so "without risking client data" still holds. It does bear on the outstanding migration step: apply the migration before or with the deploy. The opposite direction (a restart resets the in-process last-known-good) is bounded by D-04 and needs the same unreadable-tables condition, so it does not defeat criterion 1. A one-line fix is given in the review.
- **WR-02 (re-uploading the active file cannot recover a stored record that fails verification): ADVISORY.** Confirmed at `assessActivation` (`ALREADY_ACTIVE` is returned without checking that the stored record verifies). The state is still restricted-but-recoverable: `licence.activate` is continuity so activation stays reachable, and the provider can issue a replacement with a newer `issuedAt`. It is a recovery inconvenience for DB tampering or key revocation (where the old file would not verify anyway), not a bypass and not data loss.

Other warnings, for the record:

- WR-03 (a far-future `issuedAt` permanently blocks later licences, no in-product recovery): advisory, provider-side mistake hazard; worth fixing (bound `issuedAt` and warn in the issuer) before the first real licence is issued.
- WR-04 (`CheckoutNotice` `in` operator crash on `?notice=__proto__`): pre-existing, off-goal; low-risk fix.
- WR-05 (policy module and its licence wording bundled into learner and public client bundles via `ConfirmModal` and `ResourceForm`): advisory against P2 intent; the wording is not rendered to learners, but a bundle grep would match.
- WR-06 (unencrypted signing-key PEM; `0600` ineffective on Windows) and WR-07 (issuer does not self-verify output): provider-tool hardening; relevant to human item 2.
- WR-08 (dev trust keys trusted whenever `NODE_ENV !== "production"`): accepted assumption A8 and "speed bump" per PRD 18.1; the dev private halves were never persisted.
- Residual by design (not a finding): someone with direct database write access can reset `LicenceState.everActivated` and `activeRecordId` and return the deployment to the unlicensed-and-open state. This is consistent with the accepted position that the commercial agreement is the primary control (research assumption A8, PRD 18.1) and does not violate "nothing in the application can forge or self-extend".

## Accepted by the owner (not counted as gaps)

Migration not applied to the shared database; seeded Administrator keeps `licence.activate` (OQ3); D-02 option-a and OQ1 option-a; browser visual checks pending; pre-existing Phase 13 test debt (stale `payment.failed` assertion, double-registered `ticket.created` mapper, MinIO-dependent integration tests).

## Gaps summary

No code gaps. Every roadmap success criterion and all eight requirement IDs are backed by code I read, with unit proofs re-run and integration proofs taken from the recorded and owner-confirmed runs. The status is `human_needed` because five items can only be confirmed by a human: applying the migration, embedding and custody of the production public key (the production trust set is intentionally empty, so activation is impossible in production until then), the Netlify scheduled run, the browser and accessibility walkthrough, and the off-repository PRD, PXR and contract follow-ups. Advisory fixes WR-01 and WR-03 are recommended before go-live but do not block the phase goal.

---

_Verified: 2026-10-02_
_Verifier: Claude (gsd-verifier)_
