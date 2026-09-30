# API Coverage — Brevo (transactional email, `@getbrevo/brevo` ^6.0.3)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

Scope: Phase 13 uses Brevo only as the outbound transport for transactional email (COM-01, COM-04). The capability list below is the SDK's transactional-email surface (`client.transactionalEmails.*`, verified against `node_modules/@getbrevo/brevo/dist/cjs/api/resources/transactionalEmails/client/Client.d.ts` and `SendTransacEmailRequest.d.ts`) plus the adjacent Brevo resources a transactional sender could touch. INTEGRATE rows are built in Plans 02 and 04; every other row is a recorded decision with its reason.

| capability | decision | reason |
|---|---|---|
| `transactionalEmails.sendTransacEmail` | INTEGRATE | The one send call behind sendTransactionalEmail: sender, to, subject, htmlContent, textContent and replyTo from the support contact (D-13, D-14, COM-04) |
| `sendTransacEmail.tags` | INTEGRATE | The template id is sent as a tag so provider-side filtering matches the delivery log; non-personal data |
| provider error classification | INTEGRATE | classifyBrevoFailure over BadRequestError, BrevoTimeoutError and BrevoError status codes decides permanent versus transient (D-03) |
| stub transport (`EMAIL_TRANSPORT=stub`) | INTEGRATE | Dev and UAT record to EmailDispatch without contacting Brevo (D-24) |
| `sendTransacEmail.templateId` and `params` | OPT-OUT | Brevo-hosted templates: D-13 requires hand-written typed HTML templates in the repository, so copy stays in version control |
| `sendTransacEmail.messageVersions` | OPT-OUT | Batch and multi-recipient send: one recipient per EmailDispatch row keeps the (template, correlationId) dedup guarantee (D-05, COM-02) |
| `sendTransacEmail.cc` and `bcc` | OPT-OUT | Every lifecycle email has exactly one recipient; not needed |
| `sendTransacEmail.attachment` | OPT-OUT | Emails carry references only, never files (D-07, T-11-50) |
| `sendTransacEmail.scheduledAt` and scheduled-email lookups | OPT-OUT | Scheduling and retry timing are owned by the app's drain and backoff so state stays in EmailDispatch (D-02, D-03) |
| `sendTransacEmail.headers` | OPT-OUT | Provider Idempotency-Key support is unverified; the database unique constraint is the COM-02 guarantee. Revisit if the live smoke test shows it is honoured |
| `getTransacEmailsList` and `getTransacEmailContent` | OPT-OUT | The delivery record is the app's own EmailDispatch table and staff delivery log (D-06); no provider log lookup is required |
| `deleteAnSmtpTransactionalLog` | OPT-OUT | Deleting provider logs is not needed; the app keeps its own append-only record |
| `getAggregatedSmtpReport`, `getSmtpReport`, `getEmailEventReport` | OPT-OUT | Delivery analytics and reporting are not requested by COM-01 to COM-04 |
| `getTransacBlockedContacts` and `unblockOrResubscribeATransactionalContact` | OPT-OUT | Suppression list management is an operator task in the Brevo dashboard; not in CONTEXT D-01 to D-24 |
| `deleteHardbounces` | OPT-OUT | Bounce list clean-up is an operator task in the Brevo dashboard; not needed by this phase |
| `getBlockedDomains`, `blockNewDomain`, `deleteBlockedDomain` | OPT-OUT | Domain blocking is an operator task in the Brevo dashboard; not needed by this phase |
| SMTP template management (`createSmtpTemplate` and siblings) | OPT-OUT | Templates live in the repository (D-13); covers get, create, update, delete, preview and sendTestTemplate |
| `webhooks` delivery and bounce events | OPT-OUT | Not in D-01 to D-24; SENT means accepted by Brevo with a provider message id, which is the delivery record COM-01 requires. Bounce and delivery tracking is a candidate for a later phase |
| `senders` and `domains` management resources | OPT-OUT | One env-configured sender identity, verified in the Brevo dashboard by an operator, is the COM-04 design; no tenant-level editor is required |
| `inboundParsing` | OPT-OUT | Reply-To routes replies to the support mailbox; inbound reply handling is outside this phase |
| `transactionalSms` and `transactionalWhatsApp` | OPT-OUT | Email only; COM-01 specifies transactional email |
