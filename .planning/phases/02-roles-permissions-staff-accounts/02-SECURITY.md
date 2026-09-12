---
phase: "02"
slug: "roles-permissions-staff-accounts"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-09-02"
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| staff browser → Server Action (roles) | Permission set, role name, description cross as untrusted FormData | Permission strings, role metadata |
| staff browser → Server Action (assignments) | userId, roleId, scopeType, scopeId, endsAt, reason cross untrusted | Grant parameters, revocation reason |
| staff browser → Server Action (staff accounts) | Name, email, optional temp password, role, scope cross untrusted | Account creation payload, one-time credential |
| Server Action → service layer | The single authorization choke point (`withPermission`) and the only place the catalogue/scope/continuity rules are enforced | Authorization decision |
| service layer → AuditEvent sink | Arbitrary `before`/`after` domain objects, including whole `User` rows carrying credential material | Redacted business-event payloads |
| continuity-service → staff browser | The RBAC-07 block message crosses back to a UI surface | Fixed, non-interpolated denial text |
| `/staff/audit` read path → staff browser | The most security-sensitive table in the system, rendered to any `audit.view` holder | AuditEvent rows including reason text |
| create result → staff browser | The plaintext temporary password crosses back exactly once | One-time credential |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Tampering / EoP | `roleService.create`/`update` permission list | high | mitigate | `validateRolePermissionSet` re-validates every submitted identifier server-side via `isPermission()`, called in both create and update before any write | closed |
| T-02-02 | Elevation of Privilege | Assignment / first-assignment scope | high | mitigate | `assertScopeAllowed` called per permission the role carries, in `assignment-service.ts` and `staff-account-service.ts`, before any write | closed |
| T-02-03 | Denial of Service (against own operators) | RBAC-07 continuity guard | high | mitigate | `assertRoleManagementContinuity` invoked at all four D-24 trigger points (role update, role deactivate, assignment revoke, staff-account deactivate — the last unconditionally) | closed |
| T-02-04 | Repudiation | AuditEvent mutation paths | high | mitigate | `tests/audit-append-only.test.ts` scans all of `src`; confirms exactly one file creates rows and zero mutating/removing calls exist anywhere | closed |
| T-02-05 | Information Disclosure | Staff typeahead search | medium | mitigate | Gated on `users.view`, capped at 10 rows, projected to 4 identity fields only | closed |
| T-02-06 | Information Disclosure | Continuity block message | medium | mitigate | `CONTINUITY_BLOCK_MESSAGE` is a fixed constant with no interpolation; passed verbatim to the client with no count or identity ever added | closed |
| T-02-07 | Information Disclosure | Audit before/after payloads | high | mitigate | `redactForAudit` applied inside `buildAuditRow`, the sink — strips credential-shaped keys (`passwordHash`, `password`, `sessionToken`, `token`, `secret`) from every audit write | closed |
| T-02-08 | Information Disclosure | Generated temporary password | high | mitigate | Returned once from `create`'s result, never audited, logged, stored in plaintext, or placed in a URL/redirect/client storage | closed |
| T-02-09 | Spoofing | Deactivated account with live sessions | high | mitigate | `deactivate` calls `signOutAllForUser` strictly after the status-change transaction commits | closed |
| T-02-10 | Tampering | Continuity check-then-write race (TOCTOU) | low | accept | Transaction-scoped count only (user-confirmed checkpoint decision, Plan 02); residual READ COMMITTED window documented and accepted rather than closed with a row lock | closed (accepted) |
| T-02-11 | Elevation of Privilege | Role scope resolver | high | mitigate | `roleScope()` returns an empty `ResourceScope`, reachable only by a GLOBAL grant per `grantMatches` | closed |
| T-02-12 | Information Disclosure | `/staff/roles` denial path | low | mitigate | Denied state renders identical copy regardless of whether records exist (`ResourceTable`'s shared denied branch) | closed |
| T-02-13 | Tampering | Client-side reason-gate bypass | high | mitigate | Reason requirement enforced server-side from the stored before-state (`current.permissions`), never from client-claimed data | closed |
| T-02-14 | Tampering | Concurrent role edits | medium | mitigate | Optimistic lock on `Role.version`, compared before any write; stale writes rejected with `RoleVersionConflictError` | closed |
| T-02-15 | Repudiation | Role version history | high | mitigate | `RoleVersion` has no update/delete/upsert path anywhere in `src` (confirmed by grep) | closed |
| T-02-16 | Elevation of Privilege | Assignment scope resolver | high | mitigate | `assignmentTargetScope` throws `ScopeError` on a malformed non-GLOBAL scope rather than degrading to an empty (GLOBAL-reachable) resource | closed |
| T-02-17 | Tampering | Assignment revocation blast radius | high | mitigate | Update-by-id only, no `updateMany`; UI submits exactly one assignment id per action, no bulk-select control exists | closed |
| T-02-18 | Information Disclosure | Scope-target lookup | medium | mitigate | Gated on `roles.manage` alone, projected to exactly 3 fields (`id`, `label`, `identifier`) | closed |
| T-02-19 | Information Disclosure | Assignment audit scope | medium | mitigate | Both create and revoke audit events carry the assignment's real `scopeType`/`scopeId`, never blank | closed |
| T-02-20 | Information Disclosure | `/staff/audit` access | high | mitigate | Gated on `audit.view` with an empty (GLOBAL-only) scope resolver on both `list` and `filterOptions` | closed |
| T-02-21 | Information Disclosure | Audit view denial path | low | mitigate | Fixed denied copy, no record-count leakage | closed |
| T-02-22 | Tampering | Filter query parameters | medium | mitigate | Dates parsed defensively into a validation message; filtering applied server-side, never a silent unfiltered full-table read | closed |
| T-02-23 | Tampering | Non-atomic combined account+assignment create | high | mitigate | Single `prisma.$transaction` covers both inserts; single Server Action call per submission | closed |
| T-02-24 | Information Disclosure | `/staff/users` denial path | low | mitigate | Shared `ResourceTable` denied-state copy | closed |
| T-02-25 | Information Disclosure | `/staff/users/[id]` denial path | medium | mitigate | `notFound()` called on `AuthorizationError`, indistinguishable from a missing record | closed |
| T-02-SC | Tampering | npm/pip/cargo installs | low | accept | No new external packages introduced this phase — confirmed via `git status` showing no `package.json`/`package-lock.json` changes | closed (accepted) |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-10 | Transaction-scoped continuity count (not a row-level lock) leaves a narrow READ COMMITTED race where two simultaneous revocations of the last two administrators could both succeed. Accepted because: the action is rare and already reactive-only (D-27); a row lock would require raw SQL with no precedent in this codebase and would make the check untestable without a real database. User confirmed this tradeoff explicitly at the Plan 02 checkpoint. | User (checkpoint confirmation, 2026-09-02) | 2026-09-02 |
| AR-02-02 | T-02-SC | No new external packages were introduced this phase, so there is no new supply-chain surface to audit. | Auto-accepted (no new dependency exists) | 2026-09-02 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-02 | 26 | 26 | 0 | gsd-security-auditor (independent verification against implementation, not SUMMARY.md claims — re-ran `npx vitest run` (219/219 passing), `npx tsc --noEmit` (clean), `npx eslint src tests prisma` (clean) itself) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-02
