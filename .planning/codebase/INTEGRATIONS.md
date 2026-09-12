# External Integrations

**Analysis Date:** 2026-09-01

## APIs & External Services

**Payment Providers:**
- Stripe — **SDK installed (Phase 6 Plan 1, 2026-09-10)**
  - Purpose: International and card payments
  - Schema support: PaymentProvider enum, PaymentAttempt tracking, webhook event ingestion
  - SDK: `stripe@22.6.1` (exact-pinned, Node.js server only — no client-side `@stripe/stripe-js`
    needed; D-01 locks hosted Stripe Checkout, not embedded Elements)
  - Client singleton: `src/server/payments/providers/stripe/client.ts` — the only module
    permitted to construct `new Stripe(...)` (PAY-09); `STRIPE_API_VERSION` pinned to
    `2026-08-26.dahlia`
  - Auth: `STRIPE_SECRET_KEY` (`.env.local`, git-ignored); `STRIPE_WEBHOOK_SECRET` placeholder
    exists in `.env.example` but is not yet set — deferred until 06-03 builds the webhook route
  - Webhook support: `WebhookEvent` model with signature verification (route not yet built —
    06-03)
  - Currency: this account's TEST mode confirmed to accept NGN Checkout Sessions (probed
    2026-09-10 with the seeded cohort price) — clears the D-07 currency gate
  - Directory: `src/server/payments/providers/stripe/` (client module only so far; Checkout
    Session creation and webhook verification land in 06-03/06-06)

- Paystack
  - Purpose: Nigerian card and mobile money payments
  - Schema support: PaymentProvider enum, PaymentAttempt tracking, webhook event ingestion
  - Expected SDK: `paystack` (Node.js server)
  - Auth: Environment variable (secret key)
  - Webhook support: `WebhookEvent` model with signature verification
  - Directory: `src/server/payments/providers/` (empty, scaffolded)

- Manual Payment (Offline)
  - Purpose: Bank transfers, cash, administrative entries
  - Workflow: PaymentAttempt with manualChannel, manualReference, manualPaidAt, manualEvidenceKey fields
  - Approval: Manual confirmation requires confirmedById, reason fields in PaymentAttempt

## Data Storage

**Databases:**
- PostgreSQL 12+ (primary)
  - Connection: `process.env.DATABASE_URL`
  - Client: @prisma/client 6.19.3
  - Schema: `prisma/schema.prisma` (22 models, 100+ tables)
  - Transactions: Used for atomic multi-step operations (e.g., session creation with user update)
  - Row-level locking: Used in enrolment checkout to prevent overbooking

**File Storage:** (Specification layer only — implementation pending)
- Likely MinIO (per foundation spec docs)
- Schema references indicate AWS S3-compatible API
- Storage patterns in schema:
  - `LessonResource`: Course file attachments with PENDING/COMPLETED scan status
  - `Submission`: Assignment file uploads with receipt tracking
  - `TicketAttachment`: Support ticket attachments
  - `Certificate`: Generated certificate PDFs
  - `ExportJob`: Data export results
- All file references use `storageKey` (object identifier) not direct URLs
- File downloads use short-lived authorized access (NFR-06)
- Scan status field suggests virus/malware scanning integration (not yet configured)

**Caching:**
- None detected. Redis or similar not in dependencies or schema.

## Authentication & Identity

**Auth Provider:**
- Custom implementation (not Auth.js)
- Strategy: Email + password with database sessions (not JWT)

**Session Management:**
- Location: `src/server/auth/auth-service.ts`
- Storage: `Session` model in database (sessionToken, userId, expires, ipAddress, userAgent, revokedAt)
- TTL: `SESSION_TTL_DAYS` constant (configurable, retrieved from lockout.ts)
- Revocation: Selective (single session) and global (all sessions for user) — IAM-03 requirement
- No refresh token rotation; sessions stored server-side for trustworthy revocation

**Password Management:**
- Location: `src/server/auth/password.ts`
- Hashing: Bcrypt (via @node-rs/argon2 or similar, implementation in password.ts)
- No plaintext comparison; constant-time verification

**Login Security:**
- Location: `src/server/auth/lockout.ts`
- Throttling: failedLoginAttempts counter with exponential backoff
- Lockout field: `lockedUntil` DateTime on User model
- Reset: Cleared on successful login
- Schema migration: `20260901152759_login_throttling` adds these fields (IAM-06)

**Email Verification:**
- Token model: `VerificationToken` (single-use, expiring)
- Purpose field: Identifies token use (email verification, password reset, etc.)
- Consumption: consumedAt tracks when token was used

## Monitoring & Observability

**Error Tracking:**
- Not detected. No Sentry, LogRocket, or similar in dependencies.

**Logs:**
- Prisma logging configured in `src/server/db.ts`:
  - Development: Logs warnings and errors
  - Production: Logs errors only
- No centralized logging service detected; logs flow to stdout

**Audit Logging:**
- Service: `src/server/services/audit-service.ts`
- Storage: `AuditEvent` model
- Tracked: Every resource change (create, update, archive) includes actor, action, before/after state, IP, correlation ID
- Scope: Global and resource-scoped operations capture scope context

## CI/CD & Deployment

**Hosting:**
- Self-hosted deployment (per foundation spec)
- Orchestration: Docker Compose (referenced in spec docs, not yet in repo)
- Single deployable artifact: One Next.js application

**CI Pipeline:**
- Not detected. No GitHub Actions, GitLab CI, or similar configuration files present.

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string (critical)
- `.env.example` exists but not readable due to permissions

**Secrets location:**
- `.env` file (excluded from git, never committed — PRD PAY-14)
- Expected future vars: Stripe API key/webhook secret, Paystack secret key, etc.

## Webhooks & Callbacks

**Incoming (Webhook Receivers):**
- Stripe webhook endpoint: Planned, not yet implemented
  - Handler location: `src/server/payments/providers/stripe.ts` (scaffolded)
  - Event storage: `WebhookEvent` model with provider, providerEventId, payload, signatureValid, status
  - Signature verification: `signatureValid` field tracks validation result
  - Deduplication: `@@unique([provider, providerEventId])` prevents reprocessing
  - Retry logic: Status field supports RECEIVED → PROCESSING → PROCESSED flow
  - Exception handling: `exceptionNote` field in PaymentAttempt for out-of-order or conflicting events (PAY-07)

- Paystack webhook endpoint: Planned, not yet implemented
  - Handler location: `src/server/payments/providers/paystack.ts` (scaffolded)
  - Event storage: Same `WebhookEvent` model
  - Signature verification: Required before processing (PAY-14 — never log raw payloads)
  - Safe logging: Only `evidence` JSON stored, never raw provider payload with secrets

**Outgoing (Notifications):**
- Email dispatch: `EmailDispatch` model queues outbound emails
  - Status: QUEUED, SENT, FAILED
  - Deduplication: `@@unique([template, correlationId])` prevents duplicate sends (COM-02)
  - Template-based: `template` field references email template identifier
  - Provider message ID: Tracks provider's internal message reference for delivery status
  - Not yet integrated with actual email provider (Resend, SendGrid, etc.)

## Integration Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| PostgreSQL | ✅ Active | Connection configured, schema finalized |
| Payment Providers (Stripe, Paystack) | 🚧 In Progress | Stripe SDK installed + client singleton (Phase 6 P01); Checkout/webhook logic pending (06-03/06-06). Paystack still spec-only. |
| File Storage (MinIO/S3) | 📋 Spec Only | Schema references present, provider not integrated |
| Email Service | 📋 Spec Only | EmailDispatch model present, provider not integrated |
| Job Queue (pg-boss) | 📋 Spec Only | Referenced in spec docs, not in dependencies |
| Custom Auth | ✅ Active | Email/password + database sessions implemented |
| Audit Logging | ✅ Active | AuditEvent model and service complete |
| Webhook Ingestion | 📋 Spec Only | WebhookEvent model ready, Stripe/Paystack handlers pending |

---

*Integration audit: 2026-09-01*
