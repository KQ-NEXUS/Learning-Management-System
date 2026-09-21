# Phase 2: Roles, Permissions & Staff Accounts - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 2-Roles, Permissions & Staff Accounts
**Areas discussed:** Role editor & permission picker, Sensitive-edit reason threshold, Assignment drawer flow, Continuity safeguard UX (RBAC-07)

---

## Role editor & permission picker

| Question | Options offered | Selected |
|---|---|---|
| How should the 36-permission catalogue be presented? | Grouped by domain (collapsible) / Flat searchable checklist / You decide | **Grouped by domain, collapsible** |
| Starter templates for new roles? | Clone-from-default / Always blank slate / You decide | **Clone-from-default** |
| Handling of `licence.view`/`licence.activate` at non-global scope? | Visible but disabled with tooltip / Hidden entirely / You decide | **Visible but disabled, with tooltip** |
| Live effective-access preview while editing? | Yes — live summary panel / No — checked list only / You decide | **Yes — live summary panel** |
| Extra friction editing a seeded default role? | Extra confirmation naming affected users / No extra friction / You decide | **Extra confirmation naming affected users** |
| Role version history UI (RBAC-02)? | History tab with per-version diff / Version number only / You decide | **History tab with per-version diff** |
| Effect of deactivating a role on existing assignments? | Assignments become inactive immediately, warn first / Assignments stay active until individually revoked / You decide | **Assignments become inactive immediately, warn first** |
| Can a role be renamed? | Renaming allowed / Name locked after creation / You decide | **Renaming allowed** |

**Notes:** No free-text follow-ups; every question resolved to the recommended option.

-/--

## Sensitive-edit reason threshold

| Question | Options offered | Selected |
|---|---|---|
| Which permission removals require a reason? | Any removal / Only mutation-capable permissions / You decide | **Any removal** |
| Do additions require a reason? | No — reductions only / Yes for sensitive grants too / You decide | **No — reductions only** |
| Do deactivation/rename require a reason? | Deactivation yes, rename no / Neither / You decide | **Deactivation yes, rename no** |
| Reuse ConfirmModal for reason capture? | Yes, reuse as-is / Inline field in editor / You decide | **Yes, reuse as-is** |
| Minimum reason length? | 10 characters / 20 characters / You decide | **10 characters** |
| Should Assignment revoke require a reason (schema field is currently optional)? | Yes, make mandatory / No, leave optional / You decide | **Yes, make mandatory** |
| One reason per save, or per removed permission? | One shared reason / Per-permission / You decide | **One shared reason** |
| Who can see the reason text? | Anyone with audit.view / Restricted further / You decide | **Anyone with audit.view** |

---

## Assignment drawer flow

| Question | Options offered | Selected |
|---|---|---|
| How is the target user found? | Search-as-you-type / Pick from full list / You decide | **Search-as-you-type** |
| Programme/Cohort scope pickers, given Phases 4/5 build those resources in parallel? | Build full picker now, empty state until data exists / Global+Course only this phase, defer rest / You decide | **Build full picker now, empty state until data exists** |
| How are a user's multiple assignments displayed? | List of independently-revocable rows / Single "primary role" + additional list / You decide | **List of independently-revocable rows** |
| Support future-dated assignment start? | Immediate start only, optional end date / Support future start now / You decide | **Immediate start only, optional end date** |
| Multi-scope grant in one action? | One scope target per action / Multi-select batch create / You decide | **One scope target per action** |
| Staff account creation + first assignment: combined or separate? | Combined flow / Separate steps / You decide | **Combined flow** |
| Are assignments editable in place, or revoke+recreate? | Revoke + create new (immutable) / Allow in-place edits / You decide | **Revoke + create new (immutable)** |

---

## Continuity safeguard UX (RBAC-07)

| Question | Options offered | Selected |
|---|---|---|
| Which actions must trigger the zero-administrator check? (multi-select) | Revoke assignment / Remove roles.manage from role / Deactivate role granting roles.manage / Deactivate last user account holding it | **All four selected** |
| Does the check count any-scope or global-only roles.manage grants? | Global-scope only / Any-scope counts / You decide | **Global-scope only** |
| What does the block message say? | Plain statement of the constraint / Name other administrators / You decide | **Plain statement of the constraint** |
| Proactive admin-count indicator, or reactive only? | Reactive only / Proactive indicator on overview / You decide | **Reactive only** |
| Permanent "break-glass" admin account? | No — purely dynamic / Yes — seed account protected / You decide | **No — purely dynamic** |

---

## Audit view layout (RBAC-08)

*(Follow-up round, 2026-09-02 — initially left as Claude's Discretion, then discussed at user's request.)*

| Question | Options offered | Selected |
|---|---|---|
| Where does the audit view live? | Dedicated /staff/audit page / Per-record History tabs only / You decide | **Dedicated /staff/audit page** |
| Scope: Phase 2 events only, or full AuditEvent table? | Full table, all resource types / Phase 2 events only / You decide | **Full table, all resource types** |
| Which filters (multi-select)? | Actor / Date range / Action type / Target record | **Actor, Date range, Action type** |
| Row layout for variable diff content? | Table row + expandable detail panel / Full detail inline / You decide | **Table row + expandable detail panel** |

## Deactivate/reactivate staff account (IAM-04)

*(Follow-up round, 2026-09-02.)*

| Question | Options offered | Selected |
|---|---|---|
| Mandatory reason on deactivation? | Yes, via ConfirmModal / No, optional / You decide | **Yes, via ConfirmModal** |
| Effect on active sessions? | Immediately sign out all sessions / Let sessions expire naturally / You decide | **Immediately sign out all sessions** |
| Effect on existing Assignments? | Left as-is, inert via account status / Each individually revoked / You decide | **Left as-is, inert via account status** |
| Do assignments auto-restore on reactivation? | Yes, automatic / No, re-assign manually / You decide | **Yes, automatic** |

## Default-role visibility (RBAC-01)

*(Follow-up round, 2026-09-02.)*

| Question | Options offered | Selected |
|---|---|---|
| Visual distinction for default roles? | "Default" badge / No distinction / You decide | **"Default" badge** |
| List ordering? | Pinned at top / No special ordering / You decide | **Pinned at top** |
| Renaming exemption for defaults? | Same rule as any role / Defaults cannot be renamed / You decide | **Same rule as any role** |

## Claude's Discretion

None remaining — all three gray areas above were resolved in the 2026-09-02 follow-up round.

## Deferred Ideas

None — discussion stayed entirely within Phase 2's scope; no scope-creep items were raised.
