---
phase: "12"
slug: "support-tickets"
status: draft
shadcn_initialized: false
preset: none
created: "2026-09-21"
---

# Phase 12 UI Specification — Support Tickets

## 0. Grounding and Scope

This phase adds a complete learner-to-staff support workflow without introducing a second visual language. It inherits the Phase 04.1 design system, shell, semantic tokens, controls, table, detail, dialog, and reporting patterns. The support experience should feel like a calm operational workspace, not a real-time chat product.

The UI must preserve the Phase 12 domain boundaries:

- Learners see only their own tickets and public messages.
- Staff with the support capability see the full auditable chronology, including internal notes and system events.
- Context captured from a course, cohort, order, result, submission, or certificate is a locked historical reference after ticket creation.
- Messages are immutable. There are no edit or delete controls.
- Email and in-app notification delivery belong to Phase 13 and must not be promised in Phase 12 copy.
- Queue membership administration, rich text, live chat, typing indicators, presence, and bulk ticket actions are out of scope.

### 0.1 Route and entry-point contract

| Surface | Route / placement | Purpose |
|---|---|---|
| Learner support index | `/support` | View own tickets and start a new request |
| New ticket | `/support/new` | Category, subject, message, optional context and attachments |
| Learner ticket detail | `/support/[reference]` | Public chronology, attachments, reply, close/reopen actions |
| Staff queue | `/staff/support` | Tabs, filters, workload triage, assignment and escalation |
| Staff ticket detail | `/staff/support/[reference]` | Full chronology, ownership, priority, queue, internal notes and public replies |
| Support report | `/staff/reports/support` | Operational health and performance reporting using the existing report shell |
| Learner dashboard | Existing dashboard ticket slot | Up to three current tickets plus a route to Support |
| Contextual help | Eligible course/cohort/order/result/submission/certificate surfaces | “Get help with this” link that pre-fills context |

Add **Support** to learner navigation after **My learning**. Add a staff **Operations** navigation group containing **Support**; keep the support report reachable from both the Support page and the existing Reports area. Navigation items are permission-gated and use existing active, hover, focus, collapsed-sidebar, and mobile-menu behavior.

## 1. Design System

### 1.1 Tooling and visual posture

- Component source: existing hand-rolled Tailwind v4 design system. Do not initialize shadcn or install a UI library.
- Icons: existing `lucide-react` package. Use icons as reinforcement, never as the only label for consequential actions.
- Typography: Plus Jakarta Sans for interface copy and IBM Plex Mono for ticket references, compact timestamps, and data values.
- Tone: composed, trustworthy, and task-focused. Support urgency is communicated through hierarchy, labels, and semantic status treatments rather than oversized warning banners.
- New global tokens are not authorized. Use the semantic tokens already defined in `globals.css`; no raw hex values in components.

### 1.2 Icon vocabulary

Use the nearest available Lucide icons: `LifeBuoy` for Support, `Plus` for ticket creation, `Paperclip` for attachments, `Send` for public replies, `StickyNote` for internal notes, `Lock` for immutable context, `UserRoundCheck` for assignment, `TriangleAlert` for escalation/urgent priority, `CheckCircle2` for resolution, and `RotateCcw` for reopening. Every icon button requires an accessible name and tooltip; prefer icon-plus-text buttons at standard breakpoints.

## 2. Existing Primitives and Phase Components

### 2.1 Reuse without visual forks

| Existing primitive | Phase 12 use |
|---|---|
| Learner `PageHeader` | Support index, new-ticket, and learner detail headers |
| Staff `PageHeader` | Queue, staff detail, and support report headers |
| `ResourceTable<T>` | Staff ticket queue, including its mobile card projection and empty/loading/error patterns |
| `StatusPill` | Ticket status, priority, attachment state, queue and staff-only labels |
| `DetailLayout` / `DetailFacts` | Staff ticket detail structure and metadata blocks |
| Shared control constants | Buttons, inputs, selects, textareas, focus rings and disabled states |
| Existing accessible dialog pattern | Public-reply review and reason-capture operations |
| Existing report dashboard shell | Support health and performance report |

Do not force the domain-specific lesson `UploadPanel` into support. Reuse its upload mechanics and state language where appropriate, but provide a small ticket attachment picker whose constraints and retry behavior match this phase.

### 2.2 New components

| Component | Contract |
|---|---|
| `TicketStatusPill` | Thin mapping layer over `StatusPill`; no independent styling |
| `TicketTimeline` | Ordered, chronological list of public messages, internal notes, and compact system events; accepts a projection that already excludes unauthorized entries |
| `TicketAttachmentPicker` | Accepts PNG, JPEG, WebP, PDF; maximum 3 files and 10 MB each; pending, uploading, ready, failed, remove and retry states |
| `TicketContextCard` | Shows type and safe reference; removable only before ticket creation; after creation it links only when a fresh permission check allows access, otherwise it renders the locked denial state |
| `TicketComposer` | Plain-text message, attachment picker, validation and sending state; `public` and `internal` modes remain visibly distinct |
| `QueueTabs` | My work, Unassigned, All open, Escalated, Recently resolved; URL-backed selection and keyboard-operable tab semantics |
| `TicketActionDialog` | Existing dialog styling with action-specific fields for assign, reassign, escalate, priority change, resolve, close or reopen |

## 3. Spacing, Radius and Depth

Use only the inherited spacing rhythm: **4, 8, 16, 24, 32, 48, 64 px**. Do not add one-off gaps.

- Page shell: inherited responsive width and padding; 32 px between major desktop sections, 24 px on mobile.
- Cards/panels: 24 px padding desktop, 16 px mobile; 16 px internal row gap.
- Timeline entries: 16 px vertical separation; compact system events may use 8 px.
- Form field groups: 16 px; grouped action controls: 8 px.
- Standard controls use the existing 38 px height. Touch-first actions must expose at least a 44 × 44 px target.
- Use inherited radii and shadows. Internal notes use border and surface contrast, not extra elevation.
- Dialogs have 16 px viewport margins, a 640 px maximum width, and internal scrolling when content exceeds the viewport.

## 4. Typography

No new type scale is introduced.

| Role | Treatment |
|---|---|
| Page title | Inherited display heading; one `h1` per route |
| Section title | Inherited `h2`, 16 px / 600 |
| Body and message text | 14 px / 400, normal tracking, `whitespace-pre-wrap`, safe word breaking |
| Field label / tab | 13 px / 600 |
| Helper / metadata | 12 px / 400, muted foreground |
| Ticket reference / timestamp / metric | IBM Plex Mono, existing data-size treatment |

Subjects may occupy two lines in lists before truncation. Message bodies and filenames must wrap without horizontal page overflow. Never shrink a message below the body scale to fit it.

## 5. Color and Status Semantics

The surface ratio remains the established light neutral canvas, navy structural shell, and restrained blue accent. Accent is reserved for primary actions, links, active navigation, selected tabs, and focus. Status colors always include text or an icon; color alone conveys nothing.

| Meaning | Token family / treatment |
|---|---|
| `NEW`, `CLOSED` | grey/neutral pill |
| `OPEN`, `ASSIGNED` | blue pill |
| `ESCALATED` | amber pill with text label |
| `RESOLVED` | green pill |
| `LOW`, `NORMAL` | grey/neutral pill |
| `HIGH` | amber pill |
| `URGENT` | red pill; reserve danger emphasis for this and destructive/error states |
| Internal note | `warning-surface` panel, amber border/accent, “Staff only” amber pill |
| Public message | standard surface and border |
| System event | surface-2, muted foreground, compact vertical rule |
| Locked context | surface-2, neutral border, lock icon and explicit locked copy |

Use the existing success, warning, danger, border, input-border, surface, surface-2, foreground, muted-foreground and focus tokens. Do not render amber text on a pale amber fill unless the established contrast-safe ink token is used.

## 6. Copywriting Contract

Copy is plain, specific, and free of service promises that Phase 12 cannot fulfill.

### 6.1 Learner copy

| Location | Exact copy |
|---|---|
| Index title | “Support” |
| Index subtitle | “View your requests or ask for help.” |
| Primary CTA | “Create a ticket” |
| Empty title | “No support tickets yet” |
| Empty body | “If you need help with your account, payment, course, assessment, certificate, or a technical problem, create a ticket.” |
| New-ticket title | “Tell us what you need help with” |
| Context helper | “This ticket will include {type} {reference}.” |
| Context removal | “Remove context” |
| Attachment helper | “Add up to 3 PNG, JPEG, WebP, or PDF files. Maximum 10 MB each.” |
| Submit | “Create ticket” |
| Success | “Ticket {reference} was created.” |
| Reply heading | “Reply to support” |
| Reply action | “Send reply” |
| Resolved prompt | “Did this solve the issue?” |
| Resolved actions | “Close ticket” / “Reopen ticket” |
| Grace copy | “This ticket will close automatically on {date} unless you reopen it.” |
| Closed copy | “This ticket is closed. Create a new ticket if you need more help.” |

Category options are exactly **Account access**, **Payment/order**, **Course content**, **Assessment/result**, **Certificate**, **Technical problem**, and **Other**.

### 6.2 Staff copy

| Location | Exact copy |
|---|---|
| Queue title | “Support” |
| Queue subtitle | “Triage, assign, and resolve learner requests.” |
| Tabs | “My work”, “Unassigned”, “All open”, “Escalated”, “Recently resolved” |
| Public composer | “Reply to learner” |
| Public review action | “Review reply” |
| Review confirmation | “Send reply” |
| Internal composer | “Add internal note” |
| Internal badge | “Staff only” |
| Internal helper | “Only staff can see this note.” |
| Locked context helper | “Captured when this ticket was created. This reference cannot be changed.” |
| Claim action | “Assign to me” |
| Resolve action | “Resolve ticket” |

Use short reason labels that name the operation: “Assignment reason”, “Reassignment reason”, “Escalation reason”, “Priority reason”, “Resolution note”, and “Reopen reason”. Mark required reasons explicitly before submission.

### 6.3 Error and conflict copy

- Generic load: “We couldn’t load this ticket. Try again.”
- Save/reply: “Your message wasn’t sent. Your text and selected files are still here.”
- File type: “Choose a PNG, JPEG, WebP, or PDF file.”
- File size: “{filename} is larger than 10 MB.”
- File count: “You can attach up to 3 files.”
- Conflict: “This ticket changed while you were working. We loaded the latest activity—review it and try again.”
- Partial ticket upload: “Ticket {reference} was created, but {count} attachment(s) could not be uploaded. Try again from the ticket.”
- Access denied: “You don’t have access to this ticket.” Do not disclose whether another learner’s reference exists.

## 7. Screen Contracts

### 7.1 Learner support index

The page opens with the learner `PageHeader`, a primary **Create a ticket** action, and a simple list of the learner’s tickets. Each row/card shows subject, monospace reference, category, status, last-updated time, and an accessible “View ticket” target. Default ordering is most recently updated first. Paginate at 20 items.

Do not imitate the staff queue. Learners do not need assignment, priority, queue, SLA, or internal event data. On narrow screens use full-width stacked cards; on wider screens use a restrained bordered list with aligned metadata. The empty state includes one primary CTA.

### 7.2 New ticket

Use a single-column form with this order: category, subject, message, optional context card, attachments. Subject is a single-line input; message is a plain-text textarea. Context arriving from **Get help with this** is prefilled and may be removed before submission. It becomes locked once the ticket exists.

Submission creates the ticket and initial message first, then uploads selected files against the new ticket. Keep the user on the form during this orchestration and prevent duplicate submission. If all files succeed, navigate to the ticket detail with the success banner. If any upload fails, navigate to the created ticket and show the partial-upload banner with retry controls; never create a second ticket as a retry side effect.

### 7.3 Learner ticket detail

Header: back link, subject, reference, category and status. Below it, show the locked context card when present, then `TicketTimeline` containing public messages and public attachments only. Render entries as a readable record with author role, timestamp, body and attachment list—not speech bubbles.

An open ticket ends with the public reply composer. A resolved ticket replaces the composer with the resolution prompt, auto-close date, **Close ticket**, and **Reopen ticket**. A closed ticket shows closed copy and **Create a new ticket**; there is no reply field. Reopening during the seven-day grace period requires a reason and restores the composer after server confirmation.

### 7.4 Learner dashboard ticket slot

Replace the deferred ticket placeholder with a compact **Support tickets** section. Show up to three non-closed tickets ordered by most recently updated, each with subject, reference, status, and updated time. Provide **View all support tickets**. If none exist, show “No open support tickets” and a **Get help** link. The slot must not expose staff ownership or priority.

### 7.5 Contextual help

Eligible record surfaces place a secondary text link, **Get help with this**, near existing contextual actions. Opening it routes to `/support/new` with a signed/validated server-resolved context identifier; visible query text is not trusted as the stored reference. The new-ticket page presents the context card before submission. After creation, the relationship cannot be edited and retains its safe captured reference even if the source record later changes. A viewer who passes the target domain's fresh permission check receives the normal record link. A viewer who does not receives only the record type, safe reference, lock icon, and exact copy **Your role cannot open this record.**; the locked state has no link.

### 7.6 Staff queue

The staff page begins with `PageHeader` and a compact health strip for **Open**, **Unassigned**, **Urgent**, and **Escalated** counts. Counts are links to matching URL-backed filters, not decorative cards.

Below, `QueueTabs` defaults to **My work**. Every tab label includes its current count, including My work. `ResourceTable` provides search across reference, subject and learner identity plus category, priority, queue, and owner filters where relevant. Columns: reference, subject/learner, category, priority, status, queue/owner, and last activity. Default order is urgent, high, normal, low; within a priority, oldest waiting activity first; reference is the stable tie-breaker. There is no row checkbox or bulk toolbar.

Empty states are tab-specific:

- My work: “No tickets assigned to you.”
- Unassigned: “No tickets are waiting for assignment.”
- All open: “No open tickets.”
- Escalated: “No escalated tickets.”
- Recently resolved: “No tickets were resolved recently.”

Filters and tab state survive refresh through URL parameters. Mobile cards retain priority, status, owner/queue, learner and last activity without horizontal scrolling.

### 7.7 Staff ticket detail

Use `DetailLayout` with a stacked reading order:

1. Header with back link, subject, reference, status and priority.
2. Action row: assign/claim, accept an escalation, move queue, change priority, escalate, resolve; wrap actions instead of horizontally scrolling.
3. `DetailFacts`: learner, category, current owner, queue, created, last activity, resolved/closed dates when applicable.
4. Locked context card.
5. Full `TicketTimeline`.
6. Separate public and internal composer entry actions.

The timeline is one chronological `<ol>`. Public messages are normal panels, internal notes are amber staff-only panels, and lifecycle/assignment changes are compact system-event rows. Each entry shows actor and absolute timestamp; optional relative time may supplement but not replace it. Attachments show filename, type/size metadata when available, and an authenticated download action.

Public and internal authoring must never share an ambiguous send control. Selecting **Reply to learner** opens the public composer. **Review reply** opens a dialog that repeats the recipient context, exact message, and filenames; only **Send reply** commits it. Selecting **Add internal note** opens an amber-framed composer whose **Staff only** badge and helper remain visible while typing. Internal notes do not require the public review dialog.

Assignment, reassignment, escalation, urgent priority, resolution, and reopening use reason-capture dialogs where required by the domain contract. Named queue choices are exactly **General Support**, **Accounts**, **Finance**, **Learning & Assessment**, and **Technical**. Normal priority is the default. Urgent and escalation cannot be submitted without a reason; replacing an existing owner cannot be submitted without a reassignment reason. Keep dialog input if the operation fails.

All mutations are server-confirmed. Disable only the action being submitted, retain the rest of the readable ticket, and update the chronology after success. On a version conflict, load latest activity, show the conflict banner, and require the staff member to review before retrying.

### 7.8 Support reporting

Use the existing reporting dashboard and filter conventions. Provide two clearly separated views:

- **Current health:** open, unassigned, urgent, escalated, queue distribution, age bands (**under 24 hours**, **1–3 days**, **4–7 days**, **over 7 days**), and current owner workload.
- **Performance:** tickets created/resolved, median first response, median resolution time, reopen rate, and category/queue breakdown for the selected period; default to the last 30 days.

Every metric defines its denominator or scope in helper text and shows the active filter context and **as of** timestamp. Filters include date range for performance and category, queue, owner, priority, and status where applicable. CSV export is metadata-only: no message bodies, internal note text, attachment filenames, contents, or URLs. Learner identity columns appear only for viewers with the existing identity permission. Reuse existing loading, stale, empty, error and export-in-progress states; dashboard and CSV must derive from the same normalized filters and definitions.

## 8. Interaction and State Coverage

### 8.1 Loading, empty and error

- Lists use the established skeleton/placeholder rows without fabricated content.
- Detail loading preserves the page frame and reserves stable blocks for header, facts and chronology.
- Empty results distinguish “no tickets exist” from “no tickets match these filters”; filtered empties provide **Clear filters**.
- Errors appear next to the failed region when possible and preserve all unsent text and chosen file metadata.
- Permission loss replaces protected content with the standard access-denied surface; it never briefly renders ticket data.

### 8.2 Composer and upload states

- The send/create button is enabled only when required plain-text content is non-empty and all selected attachments pass local validation.
- During upload, each file announces **Uploading** and exposes progress when known. Completed files show **Ready**; failures show **Upload failed** plus **Retry** and **Remove**.
- Removing a pre-submit file is immediate and reversible only by choosing it again. Removing a stored attachment is out of scope.
- After successful send, clear the composer only after the new timeline entry is returned or re-fetched.
- Prevent double sends and duplicate ticket creation through disabled pending actions and idempotent server behavior.

### 8.3 Lifecycle states

| State | Learner affordance | Staff affordance |
|---|---|---|
| New/open | Public reply | Reply, note, assign, queue, priority, escalate, resolve |
| Assigned | Public reply | Same, with owner visible and reassignment reason when changed |
| Escalated | Public reply | Same, escalation reason visible in system history |
| Resolved within grace | Close or reopen | Reopen/close where authorized; chronology remains readable |
| Closed / grace expired | Read-only, create new ticket | Read-only chronology plus authorized administrative lifecycle action only if domain permits |

## 9. Responsive Contract

Use the established `sm` (640 px) and `lg` (1024 px) breakpoints.

| Area | Mobile | Desktop |
|---|---|---|
| Learner list | Stacked cards | Aligned bordered rows |
| Staff queue | `ResourceTable` card projection | Full table |
| Queue tabs | Horizontally scrollable tab list with visible focus; selected tab is never clipped | Inline tab row |
| Health strip | 2-column grid | 4-column row |
| Detail facts | One column | Responsive two-column definition grid |
| Ticket actions | Full-width or wrapped buttons | Compact wrapped toolbar |
| Timeline | Full-width entries; metadata wraps | Centered readable column within detail shell |
| Dialog | Viewport width minus 32 px | Maximum 640 px |

No primary workflow may require hover, a context menu, or horizontal page scrolling. Long references, email addresses, subjects, filenames, messages, and reason text must wrap safely.

## 10. Accessibility Contract

- Maintain one `h1`, logical `h2` sections, and no skipped heading hierarchy.
- Implement `QueueTabs` with correct tab roles, arrow-key navigation, visible focus, and associated panels; deep links must remain understandable without tab JavaScript.
- Render the chronology as `<ol>`/`<li>`; announce newly appended public messages and operation results through a polite live region without rereading the whole timeline.
- Inputs have persistent labels, programmatic descriptions, inline errors, and error-summary focus on failed submit.
- Dialogs move focus to the title/first invalid field, trap focus, close on Escape when safe, and restore focus to the opener. Pending destructive/integrity actions cannot be dismissed accidentally.
- File input exposes accepted formats and limits in visible and programmatic text. File status and errors are announced.
- Status, priority, staff-only state, and upload state always include text; never rely on color or icon alone.
- All controls meet the inherited contrast requirements and show the established focus ring.
- Visible timestamps use a consistent locale and include a machine-readable `datetime`; absolute time is always available.
- Download links identify the filename and file type. Opening/downloading an attachment must not expose storage URLs or authorization tokens.

## 11. Registry and Dependency Safety

No registry component or new runtime package is required. Existing primitives are sufficient. If implementation reveals a missing low-level accessibility primitive, prefer a small local component that follows existing patterns; any package addition requires an explicit planning decision and package audit.

## 12. Planner Handoff

The implementation plan must preserve these boundaries:

- Build separate learner and staff server projections; hiding staff-only entries in CSS or client filtering is invalid.
- Keep queue tabs and filters URL-backed.
- Treat ticket creation plus attachment upload as a recoverable multi-step flow.
- Include stale-write/version-conflict behavior in mutations and UI tests.
- Exercise narrow viewport, keyboard, long-content, denied-access, upload-failure, grace-period, and report-export states.
- Activate the dashboard ticket slot and contextual help links only where the relevant record identity can be server-validated.

## 13. Checker Sign-Off

- [x] Dimension 1 — PASS: every route inherits the Phase 04.1 shells, semantic tokens and primitives; the learner, queue, detail, timeline, composer and report hierarchies are explicit.
- [x] Dimension 2 — PASS: loading, empty, filtered-empty, denied, error, upload, partial-upload, pending, conflict, lifecycle and report-export states are specified; public and internal authoring cannot be confused.
- [x] Dimension 3 — PASS: headings, tabs, timeline semantics, dialogs, live regions, focus restoration, file errors, text status labels, timestamps and touch targets are covered for keyboard and narrow-viewport use.
- [x] Dimension 4 — PASS: the contract adds no typeface or open-ended scale; interface roles resolve to inherited headings or fixed 14/13/12 px text with only 400/600 weights.
- [x] Dimension 5 — PASS: spacing is restricted to the inherited 4/8/16/24/32/48/64 px rhythm; inherited control dimensions are identified; mobile and desktop behavior is specified at existing breakpoints.
- [x] Dimension 6 — PASS after revision: the exact seven categories and five queues are present; authorized and locked context states are distinct; learner/internal projections, attachment privacy, identity-gated CSV, immutable messages and Phase 13 exclusions are explicit.
