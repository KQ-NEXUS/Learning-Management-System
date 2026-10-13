---
status: testing
phase: 14-software-licence-deployment-control
source: [14-VERIFICATION.md]
started: 2026-10-02T05:30:00Z
updated: 2026-10-02T11:04:12.850Z
---

## Current Test

number: 2
name: Production signing key custody and embedding
expected: |
  Provider runs keygen, keeps the private key offline, adds the PUBLIC key (kid + x) to PRODUCTION_TRUSTED_KEYS in src/server/licence/trust-set.ts in a release, then issues and activates one real licence in production. A production-signed licence activates; a dev-key licence is rejected (UNKNOWN_KEY) in production.
awaiting: user response

## Tests

### 1. Apply the licence migration to the shared database
expected: DeploymentIdentity and LicenceState singletons exist (state UNLICENSED, everActivated false); /staff/licence loads and shows the deployment ID.
result: blocked
blocked_by: other
reason: "not yet"

### 2. Production signing key custody and embedding
expected: Provider runs keygen, keeps the private key offline, adds the PUBLIC key (kid + x) to PRODUCTION_TRUSTED_KEYS in src/server/licence/trust-set.ts in a release, then issues and activates one real licence in production. A production-signed licence activates; a dev-key licence is rejected (UNKNOWN_KEY) in production.
result: [pending]

### 3. Netlify scheduled run
expected: check-licence shows a Scheduled badge (0 * * * *), the log starts with "[scheduled] licence check: state=", and Last verification on /staff/licence advances (steps in docs/deployment/netlify-scheduled-functions.md). Hourly evaluation runs, transitions are audited once, licence.notice events drain into notifications and emails.
result: [pending]

### 4. Browser and accessibility walkthrough
expected: Licence and System Status page, staff banner, disabled write controls with the refusal note, two-step activation dialog, diagnostic download, and neutral learner copy (new registration and checkout refusal) in a restricted deployment match 14-UI-SPEC. No licence wording on learner screens, no signing material anywhere, keyboard and screen-reader behaviour acceptable (see review IN-05, IN-07). Includes the checks recorded as unrun-verify entries in .planning/WINDOWS.md for plans 14-10, 14-15, 14-18 and 14-19.
result: [pending]

### 5. Owner follow-ups from 14-PRD-AMENDMENT.md
expected: .docx twins of the PRD and PXR regenerated; signed commercial contract wording aligned with restricted continuity mode; amended PRD and PXR (gitignored under docs/reference/) placed under version control or carried elsewhere.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 1

## Gaps
