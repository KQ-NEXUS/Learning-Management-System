# Phase 14 — Commercial & Operational Research Input (Licence Module)

**Source:** ChatGPT research response, pasted by the user on 2026-10-01 ("as of 1 October 2026").
**Status:** EXTERNAL INPUT, UNVERIFIED. Vendor citations (Atlassian, GitLab, Red Hat, Keygen, LicenseSpring, Stripe, Paystack, OWASP, NIST) and the Nigerian regulatory claims (NDPA 2023, GAID 2025, NDPR transition) have not been independently checked. Legal items require counsel review. The source states there is no reliable market-wide statistic for grace periods or warning schedules; the vendor examples show practice, not an average.
**Use:** input for `/gsd-discuss-phase 14` and `/gsd-plan-phase 14`. Not a decision record.

## Open decisions raised while reviewing (not from the source)
1. Is there a provider-side validation service? Source assumes a daily online check with signed validation receipts. REQUIREMENTS.md LIC-01/LIC-04 only specify local verification against a public key plus a bounded offline policy. An online validator would be a new component. Alternative: local-only verification of the signed licence file.
2. Learner-continuity exception: may existing enrolments keep writing progress/assessments/certificates after restriction? That is not strictly "read-only" (LIC-05 wording).
3. Adopt 14-day grace and 30-day offline defaults? The contract must state the same rules.
4. Checkout after restriction: block new payment sessions, let in-flight payments finish.
5. Multi-node consistency of licence state and clock-rollback tolerance.

## Summary table (source recommendations)

| Decision | Recommended default | Acceptable range |
|---|---|---|
| Licence term | 12 months | 12–36 months |
| Multi-year option | 3-year commitment with clear price/support terms | 2–3 years |
| Renewal outreach | Commercial contact at 90 days; admin warnings at 60, 30, 14, 7, 3, 1 day | Start 60–120 days before expiry |
| Post-expiry grace | 14 calendar days, normal operation, prominent warnings | 7–30 days |
| Restriction after grace | "Continuity read-only": viewing, authentication, export, financial cleanup remain available | Avoid a literal database-wide read-only switch |
| Offline validation window | 30 days after last successful authoritative validation | 14–45 days; 60–90 only by agreement |
| Validation frequency | Local check at startup/high-impact actions; online check daily | Online every 6–24 hours |
| Export availability | Always available during expiry and termination | At least through the contractual exit period |
| Contractual notice | 90-day renewal notice plus final 30/7/1-day notices | At least 30 days plus cure/grace notices |

## 1. Licence term and renewal
- 12-month standard term; optional 3-year commitment for price certainty. Annual terms are established in self-hosted enterprise software (Atlassian Data Center: annual, renewal quotes 90 days before expiry; Red Hat: typically 1- and 3-year terms; GitLab Self-Managed: term subscriptions, admin banner 15 days before expiry).
- Cadence: day -90 quotation and named commercial contact; -60 admin banner + email; -30 banner on every admin login, weekly email; -14 and -7 stronger warning with precise grace-end date; -3, -1 and expiry daily email + persistent banner; during grace daily admin warning but no learner-facing alarm; escalate to two named client contacts if notices bounce.
- Use an exact UTC expiration instant, display client-local date and timezone. Avoid ambiguous "valid through 31 December".
- Prepaid 3-year deal: issue a licence covering the full paid period, or make the contract require automatic annual reissuance, so there is no unintended annual suspension right.

## 2. Grace period
- 14 calendar days of normal functionality after contractual expiry; restrict only when it ends.
- Covers procurement/bank/signing delays; short enough to keep the date meaningful; full operation is easier to test than progressive feature disabling; avoids harming learners over an invoice dispute. 7 days defensible for low-value fast renewals; 30 for slow procurement or public institutions; longer weakens the deadline.
- Do not combine grace periods accidentally: contract-expiry grace and network-outage window are separate clocks; the offline window must not extend the signed licence beyond expiry plus agreed contractual grace.

## 3. Read-only scope
Implement an application-level "continuity mode", not a database-wide read-only setting (a DB lock would block security events, webhook idempotency records, password resets and export jobs).

| Action after grace | Recommendation | Reason |
|---|---|---|
| View already-entitled courses | Allow | A read; avoids harming learners |
| View existing progress/results | Allow | Data remains accessible |
| Record new progress, quiz attempts, certificates | Block under strict read-only; learner-continuity exception negotiable | These are writes |
| Start a new purchase | Block before creating a payment session | Don't take money for service that may not be delivered |
| Finish a payment initiated before cutoff | Allow, then grant exact entitlement or auto-refund | Prevents "charged but nothing delivered" |
| Payment webhooks | Always accept and process | Financial records must stay accurate |
| Refunds, reversals, disputes | Allow | Financial liabilities survive expiry |
| Data export | Always allow | Core fairness and contractual exit protection |
| Login, logout, MFA, password reset | Allow | Needed to reach data, export, renewal |
| Upload a renewed licence | Allow | Required to recover |
| Security administration | Allow narrowly (session revocation, credential rotation, incident response) | |
| New courses, users, enrolments, content changes | Block | New operational use |
| New payment/session creation | Block | Prevent new commercial obligations |
| Marketing and bulk email campaigns | Block | Not necessary for continuity |
| Receipts, refund notices, security and reset email | Allow | Necessary transactional communications |

- Stripe: verify webhook signature and return success quickly before complex processing. Paystack retries unacknowledged events, advises immediate 200 OK; refunds have asynchronous states and webhooks. These routes must sit outside licence-blocking middleware.
- Stripe terms leave the merchant responsible for delivery, receipts, refunds, disputes, reversals. Licence expiry does not remove those obligations.
- Optional narrow exception for enrolments created before restriction (progress, assessment, certificate writes) is commercially kinder but no longer strictly read-only; product wording and contract must say so.

## 4. Offline validation window
Continue for 30 days after the last successful authoritative validation, subject to the signed licence's own expiry and grace dates.
1. Verify the signed licence locally at every startup and before protected actions.
2. Attempt authoritative validation daily.
3. Cache a signed validation receipt (licence ID, status, authoritative time, next-validation deadline).
4. On connection failure, warn immediately but continue for 30 days.
5. Escalate warnings at 7, 14, 21, 25, 28, 29, 30 days offline.
6. Restrict at day 30 only if validation still cannot be restored.
7. Offer a manual request/response file for deliberately disconnected environments.
- 30 days is a recognisable design point (Keygen recommends a 30-day signed licence-file TTL, separate from commercial expiry).
- Trade-offs: 7–14 days = faster revocation but fragile to firewall changes/holidays/outages; 30 = good resilience; 60–90 = for remote/controlled networks but terminated licences stay effective longer; full-term offline only for genuinely air-gapped deployments with manually renewed signed files.
- Treat "signature invalid", "wrong client/deployment", "unsupported licence schema" differently from "validation server unreachable": cryptographic invalidity restricts immediately; connectivity failure uses the offline window.
- Clock handling: store the maximum previously observed signed server time; use monotonic time within a process; tolerate ~5–10 minutes skew; escalate suspicious rollback rather than lock out on a harmless NTP correction. Offline clock tampering cannot be fully solved.

## 5. Contract, data ownership and payments
- Separate software ownership from client-data ownership. Provider retains LMS code, licence mechanisms, IP. Client owns/controls course content, learner records, progress, user info, transaction records.
- Expiry restricts licensed software operations; it does not transfer, erase, encrypt, ransom, or create a lien over client data.
- Export remains available without renewal and without paying disputed licence fees. Documented export format: CSV or JSON, original uploaded files, relationships/identifiers, schema notes, checksums. Define whether migration assistance is included or charged.
- Define restriction trigger, notices, grace, permitted continuity functions, restoration procedure. Notice to at least two named contacts; define bounce handling.
- Backups, retention, security, confidentiality, data-subject assistance and breach obligations survive expiry.
- Include a short signed emergency extension process for provider error or contested payment.
- Roles: for self-hosted, client is usually controller of learner data. Provider may become a processor when support staff access the database, receive backups/logs, or operate remote monitoring. Licence validation telemetry may make the provider an independent controller for limited provider records. Document the roles.
- GDPR: processor contract must cover documented instructions, confidentiality, security, subprocessors, assistance, return/deletion of data at controller's choice (Art. 28). Art. 20 portability is an individual right, not a substitute for the client's contractual export right.
- Nigeria: draft primarily against the Nigeria Data Protection Act 2023 and the General Application and Implementation Directive (GAID) 2025 (source: took effect 19 Sept 2025; NDPC ceased applying the 2019 NDPR as the operative instrument, subject to transitional rules). Do not rely on an old "NDPR-compliant" clause alone. Nigerian counsel to confirm controller/processor status, registration/compliance-audit obligations, cross-border transfers, incident terms. NDPA includes access to a copy in a commonly used electronic format and breach notification duties incl. 72-hour controller notification in relevant cases.
- Payments: specify merchant of record and who owns Stripe/Paystack accounts; who handles refunds, disputes, chargebacks, reconciliation after expiry; webhooks and financial records stay operational; hosted/tokenised collection with no sensitive card data stored (reduces but does not eliminate PCI obligations); retention of transaction evidence under accounting, tax, payment-network, consumer law.

## 6. Enforcement versus trust
Build enough enforcement to prevent mistakes and casual overuse, not a DRM contest with the client's sysadmin.
- Signed licence with: client ID, deployment ID, issue time, not-before time, expiry, grace end, product edition/features, licence schema version, key ID.
- Provider-held private signing key; embedded public verification keys; versioned public-key trust set so keys overlap during rotation.
- Local checks plus bounded online status checking.
- Central enforcement at a small number of server-side authorization boundaries.
- Clear audit logs and admin diagnostics.
- Contractual prohibition on bypassing/modifying checks; proportionate audit/certification rights, not invasive surveillance.
- Ed25519 is a reasonable default; ECDSA P-256 if a FIPS requirement applies.
- Do not spend heavily on obfuscation, hidden checks, or a remote kill switch. The contract, relationship and support entitlement are the final layer.
- Keep the private signing key outside the LMS in a managed vault/HSM with access controls, backups, compromise procedures, planned rotation (OWASP, NIST SP 800-57).

## 7. Expired-licence screen (admin)
Show: status (expired, in grace, offline-validation grace, invalid signature, wrong deployment, unsupported format); licence/customer name and reference number; product/environment and deployment identifier; exact expiry and restriction times with timezone; grace days remaining; last successful validation and offline deadline; plain-language list of what works and what is blocked; provider sales/renewal email, support email, phone, support hours and response time; renewal steps (request quote, complete order, receive licence, upload licence); buttons Upload licence, Retry validation, Download diagnostic report, Export data; a case/reference field for support; emergency-extension instructions if contractually available. Never expose signing material, gateway secrets, raw stack traces or sensitive personal data in the diagnostic report.

## 8. Risks commonly missed
1. Treating a network failure as an invalid licence.
2. Putting webhook, refund, password-reset or export routes behind the general write block.
3. Allowing checkout after restriction, then failing fulfilment.
4. Database-wide read-only switch instead of an application allowlist.
5. Off-by-one expiry errors (local time, DST, unclear "valid through").
6. Offline window extending the commercial expiry.
7. Relying entirely on an untrusted local clock.
8. Shipping the private signing key or licence-creation capability with the LMS.
9. No signing-key rotation or compromise-recovery plan.
10. Binding licences too tightly to hostnames/MAC/container IDs (breaks on DR, scaling, migration).
11. Different cluster nodes entering different licence states.
12. Non-atomic cache updates corrupting the last-known-good validation record.
13. Not testing old licence-schema versions after LMS upgrades.
14. No emergency extension for provider mistakes or licensing-service outages.
15. Warnings sent to a departed admin or swallowed email failures.
16. Collecting unnecessary licence telemetry without disclosure/lawful basis.
17. Disabling receipts, refund messages or security notifications as "email features".
18. No tests for leap years, timezone boundaries, clock rollback, restored backups, expiry during an in-flight payment.
19. Underestimating support demand at renewal time.
20. Ambiguous terminology: "read-only", "expired", "invalid", "offline" must be distinct states.

## Decisions for lawyer review
Licence grant/scope/environments/copying/modification/anti-circumvention; term, renewal, payment default, cure, grace, suspension, notice; exact continuity/read-only behaviour and any learner-completion exception; data ownership, no-lien, export rights, migration assistance; termination, retention, deletion, backup, confidentiality; controller/processor roles, DPA, subprocessors, cross-border transfers; GDPR and NDPA/GAID applicability; merchant-of-record, refunds, disputes, consumer rights, financial-record retention; liability, indemnity, SLAs, force majeure, governing law, dispute resolution; enforceability/proportionality of any audit or emergency suspension right.

## Decisions that can be made operationally
Cryptographic format, algorithm, key management implementation; daily validation and high-impact-action checks; 30-day offline window and warning cadence (once consistent with the contract); admin screen content and support workflow; export format and technical availability; route allowlists for webhooks, authentication, transactional email; logging, metrics, testing, DR behaviour, key-rotation runbooks; the 14-day product grace default (provided the signed contract uses the same rule).

**Guiding principle (source):** licence restriction should stop new commercial use while preserving identity, existing readable content, data recovery, security, and cleanup of financial obligations.
