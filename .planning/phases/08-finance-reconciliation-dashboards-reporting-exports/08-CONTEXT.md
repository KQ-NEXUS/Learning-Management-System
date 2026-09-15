# Phase 8: Finance Reconciliation, Dashboards & Reporting Exports - Context

**Gathered:** 2026-09-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a permission- and scope-safe Finance/Operations experience in which Stripe, Paystack, and manual payment/refund records can be reconciled; fixed operational dashboards expose trustworthy metrics and drill-downs; and dashboard and audit datasets can be exported through an asynchronous, auditable CSV lifecycle with time-limited authorized downloads. This phase does not add payment rails, learning-delivery behavior, assessments, certificate issuance, or support-ticket operations.

</domain>

<decisions>
## Implementation Decisions

### Reconciliation workspace
- **D-01:** The reconciliation landing view is exception-first: unresolved exceptions appear before summary totals and access to the complete transaction ledger.
- **D-02:** An exception may be resolved only with a standard resolution-reason category and a required case-specific note. The original exception, evidence, and resolution history remain preserved.
- **D-03:** Exceptions begin in a shared queue and may optionally be assigned to a permitted Finance user. Bulk assignment is allowed; bulk resolution is not.
- **D-04:** Use one reconciliation queue with quick tabs for All, Stripe, Paystack, and Manual. Every row identifies provider and currency.
- **D-05:** An exception opens on a dedicated detail page extending the established payment-detail pattern. It brings together the order, learner, provider references, expected and actual amounts, payment history, assignment, notes, and resolution controls.
- **D-06:** Queue priority is risk category first, then age. Captured-money problems (for example, money received without enrolment) precede settlement differences and missing provider data; the oldest record appears first within each category.
- **D-07:** Resolving an exception closes the investigation only. It must not silently change payment, enrolment, refund, expected-fee, or settlement records; corrective work uses the appropriate operational workflow and is linked in history.
- **D-08:** Materially contradictory provider evidence automatically reopens a resolved exception, retaining its previous resolution and identifying the evidence that caused reopening. — **Reversibility:** costly — changing this later alters the exception lifecycle and audit interpretation.
- **D-09:** Reconciliation visibility requires both the relevant permission and matching resource scope. Globally authorized Finance administrators may see all records; scoped staff may see only permitted programmes/cohorts.
- **D-10:** Manual payments show their confirmation amount, staff actor, reference, and evidence. Gateway-only fields display `Not applicable`, never zero and never a misleading pending value.

### Operational dashboards
- **D-11:** Provide one central Reports hub grouped into Admissions & Finance, Learning Delivery, and Outcomes & Support. Each of the ten required reporting areas has a dedicated dashboard with filters and a drill-down table.
- **D-12:** The Reports hub displays a concise set of trusted headline counts, separate financial totals by currency, last-refreshed/as-of information, and links to detailed dashboards. It is not a single page containing every detailed chart.
- **D-13:** Clicking a metric or chart segment opens the matching filtered records and preserves the originating date, programme, cohort, permission scope, and other applicable filters.
- **D-14:** Dashboards distinguish a genuine checked zero from unavailable data. Use `0` only when the query ran and no matching records exist; show `Not available yet` when the underlying capability or data collection is not operational.

### CSV export journey
- **D-15:** Staff request `Export CSV` from a dashboard using its current filters. A central Export History page shows all jobs the requester is permitted to see.
- **D-16:** Every export is an asynchronous background job, even when small enough to complete quickly. All jobs follow the same Queued → Processing → Succeeded/Failed → Expired lifecycle and are audited. — **Reversibility:** costly — the job/status contract becomes shared by all export producers and consumers.
- **D-17:** A successful CSV is downloadable for 24 hours. Job history remains after file expiry, and staff may rerun the export using the recorded configuration.
- **D-18:** Retry preserves the failed job and its safe error context, then creates a new linked attempt using the same dataset and frozen filter snapshot. It does not reset or overwrite the failed record.

### Reporting and trust rules
- **D-19:** Each dashboard date range uses the relevant business-event date and labels that basis explicitly: for example, confirmation date for payments, registration date for registrations, session date for attendance, and issue date for certificates.
- **D-20:** Filters and the `as of` timestamp are frozen when an export request is submitted. Background processing must reproduce that request-time dataset rather than including later changes. — **Reversibility:** costly — this determines export query and snapshot semantics across every dataset.
- **D-21:** CSVs use a stable, safe column set by default. Including a permitted sensitive field requires additional authorization, an explicit operational reason, and an audit record of the choice.
- **D-22:** Dashboards load when opened and refresh only through an explicit Refresh action. The interface shows last-refreshed and as-of times, and refresh preserves active filters.
- **D-23:** Carry forward the Phase 7 currency rule: NGN and USD totals remain separate. No dashboard, reconciliation total, or export invents an exchange rate or combines monetary totals across currencies.
- **D-24:** Dashboard totals, drill-down rows, and exports must use the same permission scope, filters, definitions, and as-of semantics so totals reconcile or expose an explicit timing explanation.

### the agent's Discretion
- Exact visual styling, chart types, responsive layout, pagination sizes, filter-control arrangement, and the technical threshold/batch size used by workers may follow established project patterns.
- The planner may define the initial controlled list of reconciliation risk and resolution categories, provided it preserves the priority and audit semantics above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope and requirements
- `.planning/ROADMAP.md` § Phase 8 — phase boundary, dependencies, goal, and success criteria.
- `.planning/REQUIREMENTS.md` — PAY-06, PAY-12, and RPT-01 through RPT-05 acceptance requirements.
- `.planning/PROJECT.md` — project constraints, operating assumptions, and milestone context.

### Payment and reconciliation policy
- `.planning/phases/07-multi-gateway-payments-paystack-manual-refunds/07-CONTEXT.md` — locked multi-gateway routing, price/fee snapshots, provider settlement, reconciliation, refund, and currency decisions inherited by Phase 8.
- `docs/reference/Professional-Training-LMS-PRD-Revision-3-Multi-Gateway-Payments.md` — canonical product requirements for finance dashboards, reconciliation, exports, permissions, auditability, and multi-gateway payment behavior.
- `docs/reference/Professional-Training-LMS-PXR-Revision-3-Multi-Gateway-Payments.md` — canonical operator journeys and acceptance examples for reconciliation, exception handling, filtering, export lifecycle, and auditing.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server/services/payment-reconciliation-service.ts`: provider-independent actual-settlement sweep, variance detection, idempotent writes, audit events, and expected-versus-actual calculations.
- `src/server/services/payment-read-service.ts`: finance-safe payment projections and `ESTIMATED_ONLY`, `RECONCILED`, and `EXCEPTION` derivation.
- `src/app/staff/payments/PaymentsTable.tsx` and `src/app/staff/payments/[orderId]/page.tsx`: established payment list/detail presentation to extend for reconciliation.
- `src/server/services/audit-read-service.ts` and `src/app/staff/audit/AuditTable.tsx`: append-only audit query/filter UI and expandable evidence pattern.
- `prisma/schema.prisma` `ExportJob`: existing job record with dataset, filter snapshot, lifecycle status, storage, expiry, completion, and download fields.
- `src/server/services/storage-service.ts`: existing private-object storage and time-limited signed-download patterns.
- `src/server/scheduled/reconcile-payments-task.ts`: established scheduled-worker integration point.

### Established Patterns
- Protected server services pass through `withPermission`; resource scope is enforced server-side rather than inferred from UI visibility.
- Prisma access stays inside `src/server/services/` and `src/server/db.ts`.
- Staff screens use fixed resource tables/detail layouts, explicit empty/error/denied states, URL-backed filters, and mobile-safe presentations.
- Sensitive mutations and system jobs emit append-only audit/domain evidence and use idempotent conditional writes.
- Money remains integer minor units, and unavailable actual values remain null/explicitly unavailable rather than becoming zero.

### Integration Points
- Reconciliation extends the existing payment read/detail surface and settlement sweep; it does not create a second payment state machine.
- Reports and exports must reuse the permission/scope services so aggregates, drill-downs, filters, identifiers, and downloads cannot leak out-of-scope data.
- Export generation connects `ExportJob` to the existing worker and private object-storage patterns, with an authorized download endpoint and audit trail.
- Audit export extends the existing audit filters while applying export permission, safe-column, reason, snapshot, and expiry rules.

</code_context>

<specifics>
## Specific Ideas

- The exception queue should visibly separate All, Stripe, Paystack, and Manual through tabs while retaining one consistent workflow.
- The Reports hub headline example includes registrations, active enrolments, unresolved payment exceptions, separate NGN/USD payment totals, and last-refreshed time.
- Exception resolution is an investigative record, not a shortcut for changing money or enrolment state.
- Export History remains useful after a file expires because staff can see the original dataset, filters, as-of time, result, and linked retries.

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
- `2026-09-14-fix-07-review-manual-payment-race-and-idempotency.md` — reviewed and confirmed implemented in Phase 7; it adds no remaining Phase 8 work.
- `2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` — unrelated Phase 4.1 UI hardening; remains outside the Finance/reporting phase.

</deferred>

---

*Phase: 8-finance-reconciliation-dashboards-reporting-exports*
*Context gathered: 2026-09-15*
