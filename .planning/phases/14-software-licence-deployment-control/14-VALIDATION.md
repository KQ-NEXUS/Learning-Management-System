---
phase: "14"
slug: "software-licence-deployment-control"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-01"
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `14-RESEARCH.md` § Validation Architecture. The per-task map below is seeded at requirement level; the planner and `/gsd-validate-phase` refine it to task IDs.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.11 (`test.projects`: `node`, `components`) |
| **Config file** | `vitest.config.mts` (node project: `tests/**/*.test.ts`; components project: `tests/components/**/*.test.tsx`) |
| **Quick run command** | `npx vitest run tests/licence --project node` (single file e.g. `npx vitest run tests/with-permission.test.ts --project node`) |
| **Full suite command** | `npm test` (`vitest run --no-file-parallelism`; `*.integration.test.ts` files need Docker) |
| **Estimated runtime** | ~5 s for pure licence tests; full suite several minutes |

---

## Sampling Rate

- **After every task completion:** Run the single relevant `npx vitest run <file> --project node`
- **After every plan wave:** Run `npx vitest run tests/licence tests/with-permission.test.ts tests/boundary.test.ts tests/communications-contracts.test.ts --project node`
- **Before `/gsd-verify-work`:** `npm test` green (Docker required), plus `npx tsc --noEmit` and `npm run lint`
- **Max feedback latency:** 10 seconds for pure unit files

(This user does not auto-commit; "per task" means per task completion, not per commit.)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-TBD | TBD | TBD | LIC-01 | forged/edited licence, alg/kid confusion | Altered, bad-signature, unknown/revoked key, wrong deployment, wrong client, unsupported schema, not-yet-valid and expired licences are rejected; retired key still verifies | unit | `npx vitest run tests/licence-verify.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-01 | — | Signed-input format shared by CLI and verifier (round trip, tolerant reader) | unit | `npx vitest run tests/licence-format.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-01, LIC-04 | clock rollback | State derivation correct at exact expiry, grace end, leap day 2028-02-29, Africa/Lagos rollover, 60/30/14/7/3/1 thresholds | unit (fake now) | `npx vitest run tests/licence-state.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-02 | secret/contract leakage | Status DTO and diagnostic report expose allow-listed fields only; timezone display correct | unit | `npx vitest run tests/licence-status-view.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-02, LIC-03 | self-extension, state oracle | Page and actions gated by `licence.view` / `licence.activate`; denial parity; UI offers no create/extend/edit controls | component + unit | `npx vitest run tests/components/licence-status.test.tsx --project components` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-03 | replay/downgrade, oversize upload | Activation rejects wrong client/deployment, older `issuedAt`, oversize/non-ASCII, duplicate; single atomic CAS; no partial update | integration (Testcontainers) | `npx vitest run tests/licence-activation.integration.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-04 | stale state, clock rollback | Startup hook never throws or blocks; scheduled task idempotent; 24 h last-known-good then restrict; rollback alerts without lock-out; 10 min skew tolerance | unit | `npx vitest run tests/check-licence-task.test.ts tests/licence-clock.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-04 | — | Netlify function schedule and run-once | unit | `npx vitest run tests/netlify-check-licence.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-05 | TOCTOU, state oracle | `withPermission` guard: writes blocked, continuity allowed, reads untouched; guard runs after authorization | unit | `npx vitest run tests/with-permission.test.ts tests/licence-guard.test.ts --project node` | ✅ / ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-05 | unguarded write path | No write path unguarded (service-file registry, call-site tags, continuity snapshot); closures stay request-API free | static | `npx vitest run tests/licence-enforcement-boundary.test.ts tests/boundary.test.ts --project node` | ❌ W0 / ✅ | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-05 | error leakage | Restricted-state e2e: publish/enrol/checkout/role change blocked with non-sensitive error; grade/certificate/progress/export/sign-in/activate allowed | integration | `npx vitest run tests/licence-restricted.integration.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-05, LIC-08 | charged-but-undelivered | New checkout blocked; webhook for pre-restriction attempt activates enrolment; refund allowed; expiry during in-flight payment | integration | `npx vitest run tests/licence-payments.integration.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-06 | audit flooding | Audit rows for activation, rejection, state change, enforcement, export, diagnostic download; redaction; one winner per transition | integration | `npx vitest run tests/licence-audit.integration.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-07 | notification flooding, leakage | Notice events dedupe (one Notification + one EmailDispatch per holder); recipients are Global `licence.view` holders; params carry no signing/contract detail | unit + integration | `npx vitest run tests/event-mappers-licence.test.ts tests/licence-drain.integration.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-07 | — | Exhaustive communications contract lists updated | unit | `npx vitest run tests/communications-contracts.test.ts --project node` | ✅ (must be edited) | ⬜ pending |
| 14-TBD | TBD | TBD | LIC-08 | data deletion | Restricted state deletes nothing (row-count snapshot); export routes remain reachable | integration | covered in `licence-restricted.integration.test.ts` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | D-08a | wording drift | No "read-only" wording in licence code, UI copy or licence doc lines | static | `npx vitest run tests/licence-wording.test.ts --project node` | ❌ W0 | ⬜ pending |
| 14-TBD | TBD | TBD | D-03 | private key exposure | Provider CLI mints a verifiable licence; refuses repo-relative private key paths; excluded from Docker context | unit/static | `npx vitest run tests/licence-issuer.test.ts --project node` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/support/licence-fixtures.ts` — throwaway Ed25519 keypair, `mintLicence(overrides)`, fixed-clock helpers, trust-set injection (LIC-01, LIC-03, LIC-04)
- [ ] `tests/fixtures/licence/v1/*.lic` — golden vectors: valid, expired, grace, wrong deployment, tampered, retired key, revoked key (LIC-01)
- [ ] `tests/licence-*.test.ts` files listed above, plus `tests/components/licence-status.test.tsx` (LIC-01..LIC-08)
- [ ] Existing exact-list tests to extend: `communications-contracts`, `notification-text`, `email-templates`, `event-intent-mappers`, `with-permission`, `boundary` (new closure cases), `staff-layout-nav` (new nav item)
- [ ] Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Netlify scheduled function actually fires and verifies in production | LIC-04 | Needs a published Netlify deploy; not reproducible in CI | After deploy, use the Netlify "Run now" step in `docs/deployment/netlify-scheduled-functions.md` and confirm a verification audit row |
| Production private key custody and compromise runbook | LIC-01 | Provider process outside the repo | Provider reviews the runbook deliverable and confirms key storage in a vault/HSM |
| PRD/PXR `.docx` twins match edited `.md` | D-08a | `.docx` regeneration is outside the automated suite | Owner regenerates the `.docx` files and diffs the restricted continuity mode wording |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10 s for pure unit files
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
