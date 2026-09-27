# Phase 12: Support Tickets - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 12 delivers the complete support-ticket lifecycle for learners and staff: learners can raise and follow their own tickets; non-Administrator support staff can triage, assign, reply, add private notes, escalate, resolve, and report on those tickets without gaining unrelated access. Ticket history is attributable, internal content never leaks to learners or general exports, attachments remain private and validated, and links to other LMS records always re-check the opener's existing permission.

Ticket-activity email and in-product notification delivery belongs to Phase 13. Phase 12 must preserve the events and ownership changes that Phase 13 will consume, but does not build the delivery channel.

</domain>

<decisions>
## Implementation Decisions

### Learner support journey
- **D-01:** Support is a dedicated learner destination, linked from the learner navigation and dashboard. Contextual **Get help** actions on relevant Course, Cohort, order, submission/result, and certificate surfaces open the same ticket-creation journey with the related record prefilled.
- **D-02:** Learners choose from a short controlled category list: **Account access**, **Payment/order**, **Course content**, **Assessment/result**, **Certificate**, **Technical problem**, and **Other**. The categories must remain stable enough for queue routing and reporting.
- **D-03:** Ticket attachments are limited to PNG, JPEG, WebP, and PDF. Each ticket or reply accepts at most 3 files, with a 10 MB limit per file. Declared MIME type, observed object metadata, size, and safe download behavior must be checked using the existing private-upload lifecycle.
- **D-04:** Staff mark a ticket **Resolved**, not immediately Closed. The learner may close it immediately or reopen it with a mandatory reason for 7 days. If the learner takes no action, it closes automatically after 7 days. A later occurrence is a new ticket rather than reopening an already closed ticket.
- **D-05:** The learner's ticket detail shows the reference, current status, category, creation/update times, public conversation, learner-visible attachments, and resolution/reopen state. It never reveals internal notes, internal-note attachments, hidden staff events, or the existence/count of private entries.

### Staff queue and ownership
- **D-06:** The Support workspace opens on **My work** and provides queue tabs with visible counts for **Unassigned**, **All open**, **Escalated**, and **Recently resolved**.
- **D-07:** An eligible support agent may claim an unassigned ticket. A `tickets.manage` holder may assign or reassign it to another eligible agent. Changing an existing owner requires a reason and creates an attributed, timestamped history entry.
- **D-08:** Every new ticket starts at **Normal** priority. Learners never choose urgency. Staff may change priority among Low, Normal, High, and Urgent; selecting Urgent requires a reason and produces a history entry.
- **D-09:** Escalation transfers a ticket to one of the initial named queues: **General Support**, **Accounts**, **Finance**, **Learning & Assessment**, or **Technical**. Staff may optionally name an eligible owner during escalation. A reason is mandatory, and the ticket remains Escalated until the receiving queue or owner accepts or claims it.
- **D-10:** Queue membership and ticket access remain permission-driven. The Support Agent role can run the support queue through `tickets.view` and `tickets.manage` while remaining denied financial, grading, user-management, and other unrelated operations.

### Conversation safety
- **D-11:** Staff use two separate composer actions: **Reply to learner** and **Add internal note**. This is not a mode toggle. The internal-note composer uses a persistent amber **Staff only** treatment.
- **D-12:** Sending a public reply requires a review step that shows the learner recipient, final message text, and attachment names. Internal notes save directly from their separate, clearly marked composer.
- **D-13:** Staff see one chronological timeline containing public messages, amber internal notes, and attributed system events such as status, priority, assignment, escalation, resolution, reopen, and closure changes.
- **D-14:** Learners see a separately projected public-only timeline. Hidden entries leave no placeholder, numbering gap, count, timestamp hint, or other indication that private content exists.
- **D-15:** Sent messages are immutable. There is no edit or delete action. A correction is a new, clearly labeled public reply or internal note, preserving the original audit history.

### Reporting and operational context
- **D-16:** The Support dashboard emphasizes operational health. Headline measures are Open, Unassigned, Urgent, and Escalated counts; age buckets; median first-response and resolution times; and breakdowns by category, status, priority, queue, and owner.
- **D-17:** Backlog measures are a current snapshot. Flow/performance measures default to the previous 30 days. Every metric states its definition, date basis, active filter context, and **as of** time so dashboard and CSV values can reconcile.
- **D-18:** When an agent lacks permission for a linked learner, Course, Cohort, order, submission, or certificate record, the ticket shows only a locked record type and safe reference with the message **Your role cannot open this record.** It exposes no protected fields and the link cannot be used to gain domain access.
- **D-19:** General Support CSV exports contain operational metadata only: ticket reference, lifecycle dates, category, priority, status, queue, owner, age, first-response and resolution durations, escalation count, and safe contextual record types/references. Learner identity columns require the existing identity permission. Message bodies, internal notes, and attachment contents/names never appear in the general export.
- **D-20:** Dashboard and CSV must use the same definitions and normalized filters. Private notes are excluded not merely from columns but from any projection that could reveal their content.

### Agent's Discretion
- Exact route names and responsive layout within the existing learner and staff shells.
- Exact queue-table column order, filter-control arrangement, pagination size, and age-bucket thresholds.
- Ticket reference format, provided it is non-sequential and hard to guess, consistent with existing order/certificate reference conventions.
- Persistence design for named queues and transition history, provided every transition is attributable, queryable, and adequate for reporting.
- Scheduling mechanism for the 7-day automatic close, following the deployment's established scheduled-work pattern.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and product intent
- `.planning/REQUIREMENTS.md` — SUP-01 through SUP-06 and their phase mapping; COM-01 and COM-03 clarify that outbound ticket notifications are delivered in Phase 13.
- `.planning/ROADMAP.md` — Phase 12 goal, dependencies, success criteria, and UI hint.
- `.planning/PROJECT.md` — system boundaries, security constraints, no-hard-delete rule, stack, and core learner/operator journey.
- `.planning/intel/requirements.md` — extracted PRD §11.12 acceptance detail for SUP-01 through SUP-06. The original PRD/PXR paths cited there are not present in the current working tree, so this extracted record is the available product-authority surrogate.

### Existing data and authorization foundations
- `prisma/schema.prisma` — existing `Ticket`, `TicketMessage`, and `TicketAttachment` models plus `TicketStatus`, `TicketPriority`, and `MessageVisibility`; planning must close the missing queue, transition-history, submission-link, and certificate-link needs.
- `src/server/permissions/catalogue.ts` — existing `tickets.view` and `tickets.manage` permissions.
- `src/lib/permission-groups.ts` — Support permission grouping used by custom-role authoring.
- `src/server/permissions/with-permission.ts` — mandatory authorization and denial-audit choke point.

### Learner and staff surfaces
- `src/app/(learner)/layout.tsx` — learner navigation integration point for the dedicated Support destination.
- `src/app/(learner)/dashboard/page.tsx` — learner dashboard composition and the current ticket named gap.
- `src/server/services/enrolment-dashboard-service.ts` — `TICKETS_DEFERRED` contract that Phase 12 must replace with real ticket data.
- `src/app/staff/layout.tsx` — permission-filtered staff navigation; Support must appear only for `tickets.view` holders.
- `src/components/primitives/ResourceTable.tsx` — established staff queue list, filter, empty, denied, loading, and error-state pattern.
- `src/components/primitives/DetailLayout.tsx` — established read-then-act staff detail layout.

### Attachments, reports, and integrations
- `src/lib/upload-limits.ts` — existing allow-list and size-validation vocabulary; ticket limits are narrower and fixed by D-03.
- `src/server/services/storage-service.ts` — private object-storage and presigned-transfer integration.
- `src/server/services/report-registry.ts` — existing disabled `support` report definition to widen and activate.
- `src/server/services/report-query-service.ts` — existing normalized report/filter/projection pattern.
- `src/server/support-contact.ts` — current configuration-backed support email used before a ticket system existed; Phase 12 should keep it as a fallback/contact channel rather than inventing a second value.

### Carried-forward lifecycle patterns
- `.planning/phases/09-learning-delivery-progress-tracking/09-CONTEXT.md` — learner dashboard named-gap and reactive lifecycle precedents.
- `.planning/phases/10-assessment-quizzes-assignments-grading/10-CONTEXT.md` — staff queue, learner-owned result projection, immutable evidence, and release-safety precedents.
- `.planning/phases/11-certificates-completion-lifecycle/11-CONTEXT.md` — access-controlled downloads, public/private projection, contextual certificate state, and learner dashboard widening precedent.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ResourceTable`, `StatusPill`, `DetailLayout`, `DetailFacts`, form controls, and shared button/note styles can support the staff inbox, filters, ticket detail, and status/priority indicators.
- The lesson/submission/certificate direct-upload pipelines provide the private presign → upload → confirm → authorized download lifecycle needed for ticket attachments.
- The reporting registry, query service, dashboard, export queue, and CSV download surfaces already provide the report-definition and reconciliation framework for SUP-06.
- The learner dashboard service deliberately carries a `TICKETS_DEFERRED` inhabitant, giving Phase 12 an explicit integration seam rather than requiring a dashboard redesign.

### Established Patterns
- All protected operations resolve the current actor and pass through `withPermission`; presentation visibility is convenience, never the security boundary.
- Prisma access remains confined to `src/server/services/**` and `src/server/db.ts` by ESLint.
- Server Components read data; Server Actions validate mutations and call domain services.
- State changes are append-only/audited; no hard deletes. Immutable messages and transition history align with this pattern.
- Staff navigation is derived from permissions, while learner records are projected by ownership. Ticket detail needs two deliberately different projections, not client-side filtering of a shared payload.

### Integration Points
- Add learner Support routes under the authenticated learner shell and replace the dashboard's deferred ticket column with recent/current ticket data.
- Add `/staff` Support navigation gated by `tickets.view`, with mutations separately gated by `tickets.manage`.
- Extend the existing schema: current Ticket context covers Course, Cohort, and Order but not Submission or Certificate; named queues and fully attributed transition history are also not represented.
- Activate and widen the `support` reporting dataset, ensuring report dashboard and CSV share query definitions.
- Emit durable ticket lifecycle/ownership events for Phase 13 without implementing email or in-product delivery here.

</code_context>

<specifics>
## Specific Ideas

- Learner categories: Account access; Payment/order; Course content; Assessment/result; Certificate; Technical problem; Other.
- Named queues: General Support; Accounts; Finance; Learning & Assessment; Technical.
- Staff workspace tabs: My work; Unassigned; All open; Escalated; Recently resolved.
- Internal notes use amber styling and the exact persistent label **Staff only**.
- Locked context uses the plain-language denial **Your role cannot open this record.**
- Resolution grace period is exactly 7 days.
- Attachment limits are exactly 3 files, 10 MB each, restricted to PNG, JPEG, WebP, and PDF.

</specifics>

<deferred>
## Deferred Ideas

- Transactional email and in-product delivery for ticket creation, public replies, escalation, assignment, and resolution — Phase 13. Phase 12 records/emits the underlying events only.

### Reviewed Todos (not folded)
- `2026-09-07-close-04-1-review-2-latent-mutation-warnings.md` — automatic phase matching was a false positive based on generic staff/UI terms; it concerns Phase 4.1 catalogue editors and is unrelated to support tickets.
- `2026-09-14-fix-07-review-manual-payment-race-and-idempotency.md` — automatic match was a low-confidence phase-keyword hit; it remains payment work and is not part of Phase 12.

</deferred>

---

*Phase: 12-Support Tickets*
*Context gathered: 2026-09-21*
