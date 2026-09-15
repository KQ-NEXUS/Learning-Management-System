# Phase 8: Finance Reconciliation, Dashboards & Reporting Exports - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-15
**Phase:** 8-Finance Reconciliation, Dashboards & Reporting Exports
**Areas discussed:** Reconciliation workspace, Operational dashboards, CSV export journey, Reporting rules

---

## Reconciliation workspace

### Landing view

| Option | Description | Selected |
|--------|-------------|----------|
| Exceptions first | Unresolved exceptions first, then totals and the full ledger | ✓ |
| Complete ledger first | All transactions first, with filters for exceptions | |
| Summary first | Totals and charts first, with drill-downs | |

**User's choice:** Exceptions first.

### Closing an exception

| Option | Description | Selected |
|--------|-------------|----------|
| Required note | Preserve evidence and require an explanation | ✓ |
| Optional note | Allow unexplained closure | |
| Automatic only | Staff cannot close an exception | |

**User's choice:** Resolve with a required note.

### Ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Optional assignment | Shared queue with optional individual owner | ✓ |
| Required assignment | Assignment required before investigation | |
| Shared queue only | No individual ownership | |

**User's choice:** Optional assignment.

### Provider organization

| Option | Description | Selected |
|--------|-------------|----------|
| One queue with tabs | All, Stripe, Paystack, and Manual tabs | ✓ |
| Separate pages | One reconciliation page per payment method | |
| Filter only | One table with provider dropdown | |

**User's choice:** One queue with provider tabs.

### Exception details

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated detail page | Extend the existing payment-detail pattern | ✓ |
| Side panel | Keep queue visible beside details | |
| Expandable row | Display details inline in the queue | |

**User's choice:** Dedicated detail page.

### Queue priority

| Option | Description | Selected |
|--------|-------------|----------|
| Risk, then age | Captured-money risks first; oldest first per category | ✓ |
| Oldest only | Treat all exception types equally | |
| Largest amount | Sort by financial value | |

**User's choice:** Risk category, then age.

### Meaning of resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Close investigation only | Record outcome without modifying business records | ✓ |
| Correct during resolution | Permit financial edits in the resolution form | |
| Accept provider values | Replace expected figures automatically | |

**User's choice:** Close the investigation only.

### Contradictory later evidence

| Option | Description | Selected |
|--------|-------------|----------|
| Reopen automatically | Preserve prior resolution and show reopening evidence | ✓ |
| Create linked exception | Keep original resolved and open a new case | |
| Leave resolved | Require staff to reopen manually | |

**User's choice:** Automatically reopen.

### Access

| Option | Description | Selected |
|--------|-------------|----------|
| Permission plus scope | Global Finance admins see all; scoped staff see assigned resources | ✓ |
| Finance globally | Every Finance-role user sees all records | |
| Administrators only | Exclude ordinary Finance staff | |

**User's choice:** Permission plus assigned scope.

### Manual-payment fields

| Option | Description | Selected |
|--------|-------------|----------|
| Not applicable | Show manual evidence; label gateway-only values explicitly | ✓ |
| Zero values | Render unavailable gateway values as zero | |
| Hide columns | Use a reduced manual layout | |

**User's choice:** Clearly show `Not applicable`.

### Resolution evidence

| Option | Description | Selected |
|--------|-------------|----------|
| Category and note | Standard reason plus case-specific explanation | ✓ |
| Note only | Free text without structured reason | |
| Category only | Structured reason without explanation | |

**User's choice:** Reason category plus required note.

### Bulk actions

| Option | Description | Selected |
|--------|-------------|----------|
| Bulk assignment only | Resolve every exception individually | ✓ |
| Bulk assignment and resolution | Apply one outcome across many records | |
| No bulk actions | All actions are individual | |

**User's choice:** Bulk assignment only.

**Notes:** The user twice chose to continue deeper before approving the move to dashboards.

---

## Operational dashboards

### Navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped Reports hub | Three groups with dedicated dashboards and drill-downs | ✓ |
| One combined dashboard | All ten areas on one long page | |
| Reports in each module | Distribute reporting across operational modules | |

**User's choice:** Central Reports hub with grouped dashboards.

### Reports hub content

| Option | Description | Selected |
|--------|-------------|----------|
| Overview plus category links | Concise trusted totals and detailed-dashboard links | ✓ |
| Category links only | Navigation without headline metrics | |
| Full overview | Detailed charts for all ten areas on the hub | |

**User's choice:** High-level overview plus category links.
**Notes:** The user asked which was best between the concise and comprehensive options. The recommendation explained that the concise overview reduces crowding, performance cost, and permission complexity; the user confirmed it.

### Drill-down behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Matching filtered records | Preserve source filters and scope | ✓ |
| Summary popup | Show more aggregate figures only | |
| No interaction | Keep dashboard metrics read-only | |

**User's choice:** Open the matching filtered records.

### Missing data

| Option | Description | Selected |
|--------|-------------|----------|
| Distinguish zero/unavailable | Avoid reporting false zeros | ✓ |
| Always zero | Treat all unavailable data as zero | |
| Hide unavailable | Do not render unavailable metrics | |

**User's choice:** Distinguish zero from unavailable.

---

## CSV export journey

### Starting an export

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard plus Export History | Use current filters and central job history | ✓ |
| Central page only | Configure all exports separately | |
| Dashboard only | No central export history | |

**User's choice:** From each dashboard, with central Export History.

### Processing model

| Option | Description | Selected |
|--------|-------------|----------|
| Every export is a job | One audited lifecycle for small and large exports | ✓ |
| Small direct, large async | Use a size threshold | |
| All direct | Keep request/browser waiting | |

**User's choice:** Every export becomes a background job.

### Download lifetime

| Option | Description | Selected |
|--------|-------------|----------|
| 24 hours | Short availability with persistent history | ✓ |
| 7 days | Longer sensitive-file retention | |
| One download | Expire after first successful download | |

**User's choice:** 24 hours.

### Failed export retry

| Option | Description | Selected |
|--------|-------------|----------|
| New linked attempt | Preserve failure and retry same frozen request | ✓ |
| Reuse failed record | Reset and overwrite failure state | |
| Start over manually | Return to dashboard and rebuild request | |

**User's choice:** Retry as a new linked attempt.

---

## Reporting rules

### Date meaning

| Option | Description | Selected |
|--------|-------------|----------|
| Relevant business-event date | Clearly label the dataset-specific date basis | ✓ |
| Record creation date | Use creation timestamp everywhere | |
| User-selected date basis | Add a date-field selector | |

**User's choice:** Use the relevant business-event date.

### Export snapshot time

| Option | Description | Selected |
|--------|-------------|----------|
| Request time | Freeze filters and as-of when submitted | ✓ |
| Processing start | Query state when worker begins | |
| Completion time | Include changes until generation finishes | |

**User's choice:** Export-request time.

### Sensitive columns

| Option | Description | Selected |
|--------|-------------|----------|
| Safe default, gated inclusion | Require permission, reason, and audit | ✓ |
| Always include | Export every available column | |
| Never include | Prohibit sensitive-column exports | |

**User's choice:** Safe columns by default, gated inclusion.

### Refresh behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Open plus manual refresh | Stable review with visible timestamps | ✓ |
| Periodic refresh | Automatically update every few minutes | |
| Live updates | Change figures immediately | |

**User's choice:** Load on page open plus manual Refresh.

### Currency handling

**User's choice:** Carry forward Phase 7's locked decision: NGN and USD remain separate, with no invented exchange rate.

---

## the agent's Discretion

- Exact visual styling, chart choices, responsive layout, pagination, filter layout, worker batch sizes, and the controlled category vocabulary may follow established project patterns while preserving the locked behavior.

## Deferred Ideas

- Phase 7 manual-payment race/idempotency/provider-reference todo: already implemented; not folded.
- Phase 4.1 latent async UI warnings: unrelated UI hardening; not folded.
