# Phase 14: Software Licence & Deployment Control - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-01
**Phase:** 14-software-licence-deployment-control
**Areas discussed:** Validation model, Restricted-state scope, Policy defaults & clocks, Admin screen & alerts

---

## Validation model

| Option | Description | Selected |
|--------|-------------|----------|
| Local signed file only | Verify against embedded public key; no provider service | ✓ |
| Local file + online validator | Daily check, signed receipts, 30-day offline window | |
| Local now, online hook later | Local only but shaped for later validator | |

**User's choice:** Local signed file only (Recommended)

| Signing | Description | Selected |
|---------|-------------|----------|
| Ed25519, key-ID trust set | Node crypto, versioned public keys | ✓ |
| ECDSA P-256 | FIPS case | |
| Single embedded key | Simplest | |

**User's choice:** Ed25519, key-ID trust set (Recommended)

| Generator | Description | Selected |
|-----------|-------------|----------|
| Separate provider CLI outside the app | Standalone tool + runbook | ✓ |
| Not in this phase | Verify only; dev-key test minting | |

**User's choice:** Separate provider CLI outside the app (Recommended)
**Notes:** Local-only verification removes the "validator unreachable" state; the offline-window policy was reduced to local read/verify failures (D-04).

---

## Restricted-state scope

| Option | Description | Selected |
|--------|-------------|----------|
| Learner-continuity exception | Enrolled learners keep writing progress/assessments | ✓ |
| Strict read-only | PRD §18.2 literal | |
| Learner writes yes, staff grading/certs no | Hybrid | |

**User's choice:** Yes, learner-continuity exception (Recommended)

| Allowlist (multi-select) | Selected |
|--------------------------|----------|
| Webhooks, refunds, reversals | ✓ |
| Auth, password reset, session revoke | ✓ |
| Data export + licence upload | ✓ |
| Transactional email + notifications | ✓ |

| Checkout | Description | Selected |
|----------|-------------|----------|
| Block new sessions, finish in-flight | | ✓ |
| Block all payment confirmation | PRD §19 literal | |

**User's choice:** Block new sessions, finish in-flight (Recommended)
**Notes:** Conflicts with the PRD §19 licence-interaction row; flagged in CONTEXT.md D-08.

---

## Policy defaults & clocks

| Topic | Chosen | Alternatives |
|-------|--------|--------------|
| Policy location | Signed in licence payload (warning cadence in code) | Code/env constants |
| Grace | 14 days | 30 days; 7 days |
| Clock/unreadable state | High-water mark, tolerate skew, 24h last-known-good | Trust server clock only |
| Binding | Signed deployment ID matched to DB-seeded value; state in DB | Env-var ID; no binding |

**User's choice:** All recommended options.

---

## Admin screen & alerts

| Topic | Chosen | Alternatives |
|-------|--------|--------------|
| Alerts | Reuse Phase 13 outbox + bell, plus banner | Banner only |
| Screen (multi-select) | All four: status/dates, works/blocked list, renewal contact, activate upload + diagnostics | |
| Enforcement | Inside `withPermission`, mutations default-blocked | Per-service guards |

**User's choice:** All recommended options.

---

## Claude's Discretion

Licence file encoding/field names, high-impact mutation list and continuity allowlist enumeration, stored-state model shape, scheduled cadence, banner copy, diagnostic report format, audit-view surfacing.

## Deferred Ideas

Online validator and receipts, pre-expiry revocation/suspension, emergency-extension workflow, licence telemetry, legal/contract items.
