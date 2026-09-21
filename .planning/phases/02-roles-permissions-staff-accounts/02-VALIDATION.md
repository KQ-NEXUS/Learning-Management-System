---
phase: "2"
slug: "roles-permissions-staff-accounts"
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-09-02"
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.11 |
| **Config file** | `vitest.config.mts` (`environment: "node"`, `include: ["tests/**/*.test.ts"]`, alias `@` → `src`) |
| **Quick run command** | `vitest run tests/<file>.test.ts` (targeted, per task) |
| **Full suite command** | `npm test` (== `vitest run`) |
| **Estimated runtime** | ~15-20 seconds (19 files, 219 tests, as executed) |

---

## Sampling Rate

- **After every task commit:** Run the targeted `vitest run tests/<file>.test.ts`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~20 seconds (actual, at 219 tests)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 02-01 | 1 | RBAC-01, RBAC-03 | T-02-01, T-02-11 | Tracer: create-a-custom-role end to end through every layer | unit | `vitest run tests/role-service.test.ts` | ✅ | ✅ green |
| 02-01-T2 | 02-01 | 1 | RBAC-01 | — | 14-domain grouping, global-only disabled state, effective-access preview, default pinning, clone-from-default | unit | `vitest run tests/permission-groups.test.ts` | ✅ | ✅ green |
| 02-02-T1 | 02-02 | 2 | RBAC-07 | T-02-03, T-02-06 | Continuity safeguard fires at all 4 D-24 triggers; deactivated admin never counts as active | unit | `vitest run tests/continuity-service.test.ts` | ✅ | ✅ green |
| 02-02-T2 | 02-02 | 2 | RBAC-08 | T-02-07 | AuditEvent carries scopeType/scopeId; credential-shaped fields redacted at the sink | unit | `vitest run tests/audit-service.test.ts` | ✅ (extended) | ✅ green |
| 02-02-T3 | 02-02 | 2 | RBAC-08 | T-02-04 | Audit trail is append-only across all of `src`; exactly one file creates rows | unit | `vitest run tests/audit-append-only.test.ts` | ✅ | ✅ green |
| 02-03-T1 | 02-03 | 3 | RBAC-02, RBAC-03, RBAC-07 | T-02-01, T-02-03, T-02-13, T-02-14, T-02-15 | Versioned role edit with optimistic lock, reason gate on reductions only, continuity guard at D-24b/c | unit | `vitest run tests/role-service.test.ts -t versioning` | ✅ | ✅ green |
| 02-03-T2 | 02-03 | 3 | RBAC-02, RBAC-08 | — | Role detail page: Overview/Permissions/History, inline edit, reason-gated ConfirmModals | manual (UI) | UAT Test 33 | ✅ | ✅ green (UAT-confirmed) |
| 02-04-T1 | 02-04 | 4 | RBAC-04, RBAC-07, RBAC-08 | T-02-02, T-02-16, T-02-03, T-02-17, T-02-19 | Assignment create/revoke: two-directional scope enforcement, continuity at D-24a, sibling assignments untouched | unit | `vitest run tests/assignment-service.test.ts -t scope` | ✅ | ✅ green |
| 02-04-T2 | 02-04 | 4 | RBAC-04 | T-02-18 | Scope-target lookup: roles.manage-only gate, 3-field projection | unit | `vitest run tests/scope-lookup-service.test.ts` | ✅ | ✅ green |
| 02-05-T1 | 02-05 | 3 | RBAC-08 | T-02-20, T-02-22 | Audit read service: audit.view gate, actor/date/action filters | unit | `vitest run tests/audit-read-service.test.ts` | ✅ | ✅ green |
| 02-05-T2 | 02-05 | 3 | RBAC-08 | T-02-04, T-02-21 | /staff/audit page: expand-in-place diff, denial-path parity | manual (UI) | UAT Test 34 | ✅ | ✅ green (UAT-confirmed; 1 bug found+fixed, see Gaps) |
| 02-06-T1 | 02-06 | 5 | IAM-04 | T-02-08, T-02-23, T-02-02, T-02-05 | Atomic account+first-assignment create; temp password never audited | unit | `vitest run tests/staff-account-service.test.ts -t typeahead` | ✅ | ✅ green |
| 02-06-T2 | 02-06 | 5 | IAM-04, RBAC-07, RBAC-08 | T-02-09, T-02-03, T-02-07 | Deactivate/reactivate: session sweep, unconditional continuity check, redaction | unit | `vitest run tests/staff-account-service.test.ts` | ✅ | ✅ green |
| 02-07-T1 | 02-07 | 6 | IAM-04 | T-02-24 | Users list, status tones, nav link | manual (UI) | UAT Test 35 | ✅ | ✅ green (UAT-confirmed) |
| 02-07-T2 | 02-07 | 6 | IAM-04 | T-02-08, T-02-23, T-02-18 | Combined create-and-assign form, one-time temp-password display | manual (UI) | UAT Test 36 | ✅ | ✅ green (UAT-confirmed) |
| 02-08-T1 | 02-08 | 7 | RBAC-04, IAM-04 | T-02-17, T-02-25 | User detail page, per-row revoke, deactivate/reactivate controls | manual (UI) | UAT Test 37 | ✅ | ✅ green (UAT-confirmed; 1 bug found+fixed, see Gaps) |
| 02-08-T2 | 02-08 | 7 | RBAC-04 | T-02-05, T-02-02, T-02-13 | Assignment drawer: user typeahead, 4-scope picker | manual (UI) | UAT Test 37 | ✅ | ✅ green (UAT-confirmed) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/role-service.test.ts` — covers RBAC-01, RBAC-02, RBAC-03
- [x] `tests/assignment-service.test.ts` — covers RBAC-04
- [x] `tests/continuity-service.test.ts` — covers RBAC-07 (all 4 D-24 triggers + the deactivated-admin exclusion pitfall)
- [x] `tests/staff-account-service.test.ts` — covers IAM-04
- [x] Extended `tests/audit-service.test.ts` — covers RBAC-08's scope-field gap
- [x] No new framework install needed — Vitest harness pattern from `tests/resource-service.test.ts` reused (mock `Delegate<T>`, `createWithPermission` with fixed grants, assert on captured audit entries)
- [x] Additional test files beyond the original Wave 0 plan: `tests/permission-groups.test.ts`, `tests/audit-append-only.test.ts`, `tests/audit-read-service.test.ts`, `tests/scope-lookup-service.test.ts` — all passing

**Total: 219 tests passing across 19 files** (up from 84 at phase start), confirmed via `npm test`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Role detail page rendering, tab interaction, inline edit, ConfirmModal flows | RBAC-02 | Visual/interaction confirmation — service logic is unit-proven, rendering is not | UAT Test 33 (completed, pass) |
| /staff/audit filtering, expand-in-place accordion, diff rendering | RBAC-08 | Visual/interaction confirmation | UAT Test 34 (completed, pass — after fixing a missing React key prop, G-02-34) |
| /staff/users list rendering, status-tone colors | IAM-04 | Visual confirmation | UAT Test 35 (completed, pass) |
| Combined create-and-assign form, temp-password success panel, scope-target search | IAM-04 | Visual/interaction confirmation | UAT Test 36 (completed, pass) |
| User detail page, Assignments panel, AssignmentDrawer typeahead and save flow | RBAC-04, IAM-04 | Visual/interaction confirmation | UAT Test 37 (completed, pass — after fixing a next/headers client-bundle build error, G-02-37) |

All five manual-only items were exercised and passed during the `/gsd-verify-work` UAT session on 2026-09-02, with two real bugs found and fixed in the process (see `02-UAT.md` Gaps: G-02-34, G-02-37, both resolved and re-verified).

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

## Validation Audit 2026-09-02

| Metric | Count |
|--------|-------|
| Requirements checked | 7 (RBAC-01, 02, 03, 04, 07, 08, IAM-04) |
| Automated (unit) | 12 test files, 219 tests, all passing |
| Manual (UAT-confirmed) | 5 UI-facing behaviors, all passing after 2 fixed bugs |
| Gaps found | 0 (all planned Wave 0 coverage was implemented; 2 implementation bugs were found via UAT, not coverage gaps, and both are resolved) |

**Approval:** validated 2026-09-02
