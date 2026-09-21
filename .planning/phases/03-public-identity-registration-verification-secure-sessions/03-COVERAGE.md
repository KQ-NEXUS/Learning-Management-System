# API Coverage — Brevo (`@getbrevo/brevo` v6)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
>
> Phase 3 integrates exactly one Brevo capability: outbound transactional email
> send, wrapped in `src/server/email/brevo-client.ts` (D-01) with an
> `EmailDispatch` bookkeeping row per send (D-17). Sender identity comes from
> `EMAIL_SENDER_NAME` / `EMAIL_SENDER_ADDRESS` (D-04). Everything else on the
> Brevo surface is opted out below with a reason.
>
> **Deferred to Phase 13** (Transactional Communications & Notifications,
> COM-01..COM-04) means the capability is expected to be re-decided there, not
> discarded. Phase 13 starts from this matrix, not from zero.

| capability | decision | reason |
|---|---|---|
| `transactionalEmails.sendTransacEmail` | INTEGRATE | |
| `transactionalEmails.sendTransacEmail` (scheduled sends, `scheduledAt`) | OPT-OUT | every Phase 3 email (verification, reset, email-change confirmation) is sent immediately; no scheduling requirement |
| `transactionalEmails.getScheduledEmailById` | OPT-OUT | no scheduled sends exist to inspect |
| `transactionalEmails.deleteScheduledEmailById` | OPT-OUT | no scheduled sends exist to cancel |
| `transactionalEmails.getTransacEmailsList` | OPT-OUT | the local `EmailDispatch` table is this milestone's send record; no provider-side listing needed |
| `transactionalEmails.getTransacEmailContent` | OPT-OUT | message bodies are composed in-app and contain single-use tokens; re-fetching them from the provider is an unnecessary exposure |
| `transactionalEmails.deleteAnSmtpTransactionalLog` | OPT-OUT | no provider-log retention policy in this milestone |
| `transactionalEmails` SMTP templates | OPT-OUT | covers get/create/update/delete/preview/sendTest — Phase 3 sends plain-text bodies composed in application code (D-01); provider-hosted templating is deferred to Phase 13 (COM-01, COM-04) |
| `transactionalEmails.getTransacBlockedContacts` | OPT-OUT | not needed yet — see Known Consequence 1 below; deferred to Phase 13 (COM-01 exactly-once delivery) |
| `transactionalEmails.unblockOrResubscribeATransactionalContact` | OPT-OUT | not needed yet — no operator UI for unblocking in this milestone; deferred to Phase 13 |
| `transactionalEmails.deleteHardbounces` | OPT-OUT | not needed yet — no bounce-remediation workflow in this milestone; deferred to Phase 13 |
| `transactionalEmails` blocked domains | OPT-OUT | covers getBlockedDomains/blockNewDomain/deleteBlockedDomain — domain-level blocking is a Brevo-console operations task, not an application concern |
| `transactionalEmails.getAggregatedSmtpReport` | OPT-OUT | delivery analytics are out of scope this milestone; deferred to Phase 13 |
| `transactionalEmails.getSmtpReport` | OPT-OUT | delivery analytics are out of scope this milestone; deferred to Phase 13 |
| `transactionalEmails.getEmailEventReport` | OPT-OUT | per-event delivery tracking (delivered/opened/bounced) is out of scope this milestone; deferred to Phase 13 |
| `webhooks` | OPT-OUT | no inbound delivery callbacks — see Known Consequence 1; deferred to Phase 13 (COM-01) |
| `senders` | OPT-OUT | one sender identity, set via environment variables (D-04) and verified once in the Brevo console; no programmatic sender management |
| `domains` | OPT-OUT | DNS/DKIM/SPF setup is a one-time deployment task (Phase 14), not an application capability |
| `inboundParsing` | OPT-OUT | the sender is no-reply; inbound replies are not processed by this system |
| `contacts` | OPT-OUT | learner records live in the application database; no contact-list synchronisation to Brevo this milestone |
| `consentGroups` | OPT-OUT | marketing consent is recorded locally in `PolicyAcceptance` (D-12); no provider-side consent store |
| `emailCampaigns` | OPT-OUT | marketing campaigns are explicitly out of scope for this product |
| `transactionalSms` | OPT-OUT | email is the only channel this milestone |
| `smsCampaigns` | OPT-OUT | email is the only channel this milestone |
| `smsTemplates` | OPT-OUT | email is the only channel this milestone |
| `transactionalWhatsApp` | OPT-OUT | email is the only channel this milestone |
| `whatsAppCampaigns` | OPT-OUT | email is the only channel this milestone |
| `conversations` | OPT-OUT | learner support is in-app ticketing (Phase 12), not a Brevo chat inbox |
| `companies` | OPT-OUT | no CRM in this product |
| `deals` | OPT-OUT | no CRM in this product |
| `notes` | OPT-OUT | no CRM in this product |
| `tasks` | OPT-OUT | no CRM in this product |
| `ecommerce` | OPT-OUT | commerce is owned by Stripe/Paystack (Phases 6–8); no order data is sent to Brevo |
| `payments` | OPT-OUT | commerce is owned by Stripe/Paystack (Phases 6–8) |
| `coupons` | OPT-OUT | discounting is not in the current milestone scope |
| `program` | OPT-OUT | loyalty programmes are not in this product |
| `reward` | OPT-OUT | loyalty rewards are not in this product |
| `event` | OPT-OUT | Brevo's marketing-automation event stream is out of scope; lifecycle events stay in-application (Phase 13) |
| `process` | OPT-OUT | marketing-automation processes are out of scope |
| `externalFeeds` | OPT-OUT | no external data feeds into Brevo |
| `customObjects` | OPT-OUT | no custom data model mirrored into Brevo |
| `files` | OPT-OUT | no file/asset hosting via Brevo |
| `account` | OPT-OUT | account administration is a console/billing task, not an application capability |
| `user` | OPT-OUT | Brevo sub-user administration is a console task |
| `masterAccount` | OPT-OUT | single Brevo account; no master/sub-organisation structure |
| `tier` | OPT-OUT | plan/tier management is a billing-console task |
| `balance` | OPT-OUT | credit-balance management is a billing-console task |
| `wallet` | OPT-OUT | wallet management is a billing-console task |

---

## Known Consequences of These Opt-Outs

Recording these here is the point of the matrix — they are accepted gaps, not
oversights.

1. **A hard-bounced or complained-about address is blocked at Brevo, and this
   system will not know.** With `webhooks`, `getTransacBlockedContacts`, and
   `deleteHardbounces` all opted out, a send to a blocked address fails at the
   provider. `emailDispatchService.dispatch` records `status: FAILED` with the
   provider's error string, so the failure is visible in the database — but no
   operator is notified, and the learner sees the same non-enumerating "if an
   account exists, we've sent a link" message either way. Acceptable this
   milestone because the failure is recorded and recoverable by re-registering
   with a different address; Phase 13's COM-01 ("exactly once, reliably
   reaches the right person") is where this must be closed.

2. **No delivery confirmation beyond "the provider accepted it."** A
   `providerMessageId` proves acceptance, not delivery. Opting out of the
   reporting and event endpoints means "sent" in `EmailDispatch` means
   "accepted by Brevo." Deferred to Phase 13.

3. **No provider-side send retry.** A transient Brevo failure surfaces as a
   thrown error and a `FAILED` row; the user's remedy is the resend/recovery
   form already built in Phase 3. Queue-backed retry is Phase 13's concern.
