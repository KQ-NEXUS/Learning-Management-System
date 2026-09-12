# Phase 3: Public Identity — Registration, Verification & Secure Sessions - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 3-Public Identity — Registration, Verification & Secure Sessions
**Areas discussed:** Verification & reset email delivery, Policy acceptance scope at registration, Profile & communication preferences (IAM-05), Public-facing page style

---

## Verification & reset email delivery

| Option | Description | Selected |
|--------|-------------|----------|
| Wire Postmark now | Matches docs/TRACK-A-TASKS.md Day 3 exactly | |
| Dev-only stand-in | Log/display link, fully defer to Phase 13 | |
| Other | User asked "is Postmark the only option?" | ✓ (led to Brevo) |

**User's choice:** Brevo — after being told the `EmailDispatch` schema is provider-agnostic and other options exist (Resend, SendGrid, AWS SES, SMTP), the user chose Brevo. Confirmed as a locked decision in a follow-up question.
**Notes:** Same minimal-wrapper scope as the original Postmark option — just a different provider.

| Question | Selected | Notes |
|---|---|---|
| Verification/reset link expiry | Verify 24h / Reset 1h | Reset window tighter since it grants account access |
| Resend behavior | Issue new, invalidate old | Only the newest link works |
| Sender identity | Generic placeholder for now | Real client brand/domain not yet locked |
| Rate limit on email requests | Yes — simple per-address cooldown | e.g. one request per 60s |

---

## Policy acceptance scope at registration

| Option | Description | Selected |
|--------|-------------|----------|
| Terms + Privacy only, no order yet | orderId null; Refund/Marketing move to Phase 6 | ✓ |
| All four policies at registration | Front-loads REG-04 fully | |

**User's choice:** Terms + Privacy only, no order yet.
**Notes:** Refund/cancellation policy is a strange thing to ask before a visitor has chosen anything to buy — naturally order-bound, so it belongs at Phase 6 checkout.

| Question | Selected | Notes |
|---|---|---|
| Policy versioning | Simple date-string constant | Manual bump when text changes, no CMS |
| Re-registration with PENDING_VERIFICATION email | Resend verification, don't recreate | Non-enumerating response either way |

---

## Profile & communication preferences (IAM-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Name, phone, email-change via re-verify | Email change requires re-verification | ✓ |
| Name and phone only, no email change | Simpler, no self-service email fix | |

**User's choice:** Name, phone, email-change via re-verify.

| Option | Description | Selected |
|--------|-------------|----------|
| One marketing toggle, transactional always on | Single preference; transactional never optional | ✓ |

**User's choice:** One marketing toggle, transactional always on.

| Question | Selected | Notes |
|---|---|---|
| Where marketing toggle state lives pre-checkout | Toggle writes its own PolicyAcceptance row | Same mechanism Phase 6 uses at checkout |
| Audit profile edits? | Yes — same AuditEvent pattern | Matches "every state change is audited" convention |
| Email change step-up | Yes — require current password | Reuses verifyPassword() |

---

## Public-facing page style

| Option | Description | Selected |
|--------|-------------|----------|
| Match existing /signin exactly | Same minimal centered Tailwind card, no chrome | ✓ |
| Distinct public-facing shell | Header/footer/marketing tone | |

**User's choice:** Match existing /signin exactly.
**Notes:** Directly motivated by the user's earlier stated concern in this project about avoiding "2 different codes and UI that dont match." A distinct shell is deferred to Phase 4 when the public catalogue exists to justify it.

---

## Claude's Discretion

None — all four areas reached explicit decisions.

## Deferred Ideas

- Full REG-04 scope (Refund/Cancellation policy, order-bound marketing consent) — Phase 6 checkout.
- Distinct public-facing visual shell — Phase 4, alongside the public catalogue.
- Real client sender domain/brand for transactional email — whenever approved (config swap only).
