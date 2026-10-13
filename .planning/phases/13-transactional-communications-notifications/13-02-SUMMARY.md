---
phase: 13-transactional-communications-notifications
plan: 02
subsystem: email
tags: [brevo, email, templates, html, transactional, docker-compose, vitest]

requires:
  - phase: 13-01
    provides: TEMPLATE_IDS and TEMPLATE_CATEGORY in src/server/communications/contracts.ts
provides:
  - src/server/email/config.ts, the single place for sender identity, brand, Reply-To, public base URL, transport mode and header sanitising
  - Brevo client sending html plus text with sender, Reply-To and tags, stub transport, and permanent versus transient failure classification
  - Shared 600px table-based branded layout with derived text alternative
  - Typed registry of all 27 templates (auth, learner, staff) with samples, exhaustive over TEMPLATE_IDS
  - docker-compose passthrough with no injected sender identity
affects: [13-03 .. 13-13 dispatch, drain, mappers, auth services]

actuals:
  tokens: 28000
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Deployment identity read in exactly one module; missing value throws EmailConfigError naming the variable, never its value"
    - "Templates declare allow-listed params and read only declared fields, so an event payload spread cannot leak"
    - "TEMPLATE_REGISTRY is a total Record over TEMPLATE_IDS; a missing template is a compile error"
    - "Links are built only from internal paths via buildAbsoluteUrl; auth templates additionally assert the public origin"

key-files:
  created:
    - src/server/email/config.ts
    - src/server/email/templates/layout.ts
    - src/server/email/templates/registry.ts
    - src/server/email/templates/learner-templates.ts
    - src/server/email/templates/auth-templates.ts
    - src/server/email/templates/staff-templates.ts
    - tests/email-config.test.ts
    - tests/email-templates.test.ts
  modified:
    - src/server/email/brevo-client.ts
    - src/server/support-contact.ts
    - docker-compose.yml
    - tests/brevo-client.test.ts
    - tests/docker-email-config.test.ts

key-decisions:
  - "Brand name in mail equals the configured sender name (one approved identity, COM-04)"
  - "Session dates render through the existing formatDateTimeShort (UTC-pinned) with a UTC label; src/lib/timezone.ts has no formatter"
  - "certificate-revoked carries no button or link (reference only, no path param)"
  - "Withdrawn, cancelled and cohort-cancelled mails link to /dashboard as a fixed internal path since the plan gives them no path param"

requirements-completed: [COM-01, COM-04]

coverage:
  - id: D1
    description: "Fail-loud single sender identity, brand, Reply-To, base URL and transport config; open-redirect-safe absolute links"
    requirement: "COM-04"
    verification:
      - kind: unit
        ref: "tests/email-config.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Brevo payload carries sender, replyTo, subject, html and text with no templateId; stub transport; failure classification"
    requirement: "COM-04"
    verification:
      - kind: unit
        ref: "tests/brevo-client.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "27 templates render escaped, allow-listed, absolute-linked subject, html and text through one layout"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/email-templates.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "docker-compose passes sender name and address through without a default"
    requirement: "COM-04"
    verification:
      - kind: integration
        ref: "tests/docker-email-config.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Emails read correctly and the button stays tappable in Gmail, Outlook and Apple Mail, light and dark themes"
    requirement: "COM-01"
    verification: []
    human_judgment: true
    rationale: "Table-based markup is verified by tests; real mail-client rendering can only be confirmed by looking."
  - id: D6
    description: "No marketing or engagement-nudging copy in any template"
    requirement: "COM-01"
    verification:
      - kind: unit
        ref: "tests/email-templates.test.ts#renders subject, html and text from its sample (urgency phrase check)"
        status: pass
    human_judgment: true
    rationale: "A phrase regex catches obvious urgency wording only; tone is a judgment call."

duration: 25min
completed: 2026-09-27
status: complete
---

# Phase 13 Plan 02: Email Identity, Brevo Transport and Template Registry Summary

**One fail-loud sender/Reply-To/base-URL config module, an html+text Brevo client with stub mode and permanent/transient classification, and a total 27-template branded registry with allow-listed params and open-redirect-safe links.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-09-27
- **Tasks:** 3
- **Files:** 8 created, 5 modified

## Accomplishments
- `config.ts`: `EmailConfigError`, `getSenderIdentity`, `getBrandName`, `getReplyTo`, `getPublicBaseUrl` (throws in production when unset), `buildAbsoluteUrl` (internal single-slash paths only), `getEmailTransportMode` (`stub` opt-in, unknown throws), `sanitizeHeaderText`.
- `brevo-client.ts`: resolves sender and Reply-To on every send (stub mode included), returns `stub:<uuid>` without constructing `BrevoClient` in stub mode, new `classifyBrevoFailure`, config-safe `describeBrevoFailure`. The old exact-shape payload test passes unchanged.
- `layout.ts` and `registry.ts`: literal-hex `EMAIL_COLORS`, `escapeHtml`, 600px table layout with a 44px bulletproof button, derived plain text with the raw link on its own line, and `renderEmail`.
- 20 learner, 3 auth and 4 staff templates; `TEMPLATE_REGISTRY` is a total Record over `TEMPLATE_IDS`.
- `requireSupportContactEmail()` added; `SUPPORT_CONTACT_EMAIL` export untouched.
- docker-compose no longer injects a sender name or address, and forwards `SUPPORT_CONTACT_EMAIL` and `EMAIL_TRANSPORT`.

## Task Commits

No commits were made (owner standing rule). Suggested messages, hash `uncommitted`:

1. **Task 1: Tracer, config, Brevo client, layout, ticket-reply** - `uncommitted` - `feat(13-02): add email config, html+text Brevo client and shared layout tracer`
2. **Task 2: Learner templates** - `uncommitted` - `test(13-02): add failing learner template tests` then `feat(13-02): add the 20 learner email templates`
3. **Task 3: Auth and staff templates, compose passthrough** - `uncommitted` - `feat(13-02): add auth and staff templates and drop compose sender defaults`

**RED observed:** Task 1 tests failed at import (config and registry modules did not exist). Task 2: 98 of 108 tests failed before learner templates existed. Task 3: the auth/staff/exhaustiveness tests failed before the modules existed; the two docker tests timed out on the default 5s limit on the first run, so their RED is a timeout rather than an assertion (see Deviations).

## Files Created/Modified
- `src/server/email/config.ts` - single identity, base URL and transport config
- `src/server/email/brevo-client.ts` - html+text send, stub mode, classification
- `src/server/support-contact.ts` - added `requireSupportContactEmail`
- `src/server/email/templates/layout.ts` - layout, colours, `escapeHtml`
- `src/server/email/templates/registry.ts` - `renderEmail`, total registry, samples
- `src/server/email/templates/learner-templates.ts`, `auth-templates.ts`, `staff-templates.ts` - the 27 templates
- `docker-compose.yml` - sender passthrough, no defaults
- `tests/email-config.test.ts`, `tests/brevo-client.test.ts`, `tests/email-templates.test.ts`, `tests/docker-email-config.test.ts`

## Decisions Made
- See key-decisions above. Brand equals sender name; session dates use the UTC-pinned `formatDateTimeShort`.

## Deviations from Plan

**1. [Rule 3 - Blocking] Docker compose tests need a longer timeout**
- **Found during:** Task 3
- **Issue:** each `docker compose config` call takes 7 to 11 s, over vitest's 5 s default, so both tests timed out.
- **Fix:** set `timeout: 60_000` on both tests in `tests/docker-email-config.test.ts` (already in the plan's file list).
- **Verification:** both pass.

**2. [Rule 3 - Blocking] Test-file editing artefact**
- **Found during:** Task 3
- **Issue:** a shell-heredoc retry appended the auth/staff test block twice to `tests/email-templates.test.ts`, causing redeclared constants.
- **Fix:** removed the duplicate block. No source impact.

**Total deviations:** 2 auto-fixed (both Rule 3, test-tooling only). **Impact:** none on scope.

## Issues Encountered
- `.env.example` is under the project deny rule, so the new variable names were not documented there (see follow-ups).
- Tests that read `docker compose config` use `--env-file .env.example`, which this run did not read; they pass.

## Follow-ups for the owner
- **Set these deployment variables** (no defaults exist, the app refuses to send if unset): `BREVO_API_KEY`, `EMAIL_SENDER_NAME`, `EMAIL_SENDER_ADDRESS` (verified in Brevo Senders, Domains & Dedicated IPs), `SUPPORT_CONTACT_EMAIL`, `APP_BASE_URL` (required in production). `EMAIL_TRANSPORT=stub` is available for non-live runs.
- **Document those names in `.env.example`** manually (not editable in this environment).
- Existing `EmailDispatch` callers now fail loudly when `EMAIL_SENDER_*` or `SUPPORT_CONTACT_EMAIL` is unset (previously they used made-up defaults).
- **Look at rendered emails** in Gmail, Outlook and Apple Mail, light and dark, before launch (coverage D5).
- Commit the uncommitted work when ready.

## Known Stubs
None. `TEMPLATE_SAMPLES` are test fixtures, not UI data.

## Threat Flags
None beyond the plan's threat model. Threat mitigations T-13-03, -05, -06, -09, -10, -14 are covered by tests.

## User Setup Required
Brevo service configuration is required. See the follow-ups above (env vars and sender verification).

## Next Phase Readiness
Later plans can call `renderEmail(template, params)` and `sendTransactionalEmail(...)`, and import `classifyBrevoFailure`. The old `sendTransactionalEmail({to, subject, textContent})` call shape in `email-dispatch-service.ts` still compiles and passes its tests.

## Verification
- `npx vitest run` on email-config, brevo-client, email-templates, docker-email-config, boundary, email-dispatch-service: 6 files, all pass.
- `npx tsc --noEmit` and `npx eslint src/server/email`: clean.

## Self-Check: PASSED
- All 8 created and 5 modified files exist on disk and appear in `git status --porcelain`.
- No commits made, as expected under the owner rule. No database was touched in this plan (no Prisma commands were run).

---
*Phase: 13-transactional-communications-notifications*
*Completed: 2026-09-27*
