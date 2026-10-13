---
phase: 14-software-licence-deployment-control
plan: 02
subsystem: licensing
tags: [licence, ed25519, node-crypto, zod, golden-vectors, trust-set]

requires:
  - phase: 14-software-licence-deployment-control
    provides: "14-DECISIONS.md D-02 contract decision (option-a, compact LMS-LIC1 envelope approved as written)"
provides:
  - "src/server/licence pure module: constants, errors, format (envelope, zod schemas, 11-code rejection set), trust-set, verifyLicence"
  - "verifyLicence(raw, ctx) result union with Date-typed VerifiedLicence; Ed25519 over exact ASCII bytes, alg pinned, kid trust set"
  - "Versioned trust set: PRODUCTION_TRUSTED_KEYS (empty), DEV_TRUSTED_KEYS (active/retired/revoked), loadTrustSet (dev keys excluded in production)"
  - "tests/support/licence-fixtures.ts (mintLicence via the shared encodeLicenceEnvelope) and a one-shot golden-vector generator"
  - "Ten schema-1 golden vectors plus manifest.json locking the published contract"
  - "licence-purity test: executable evidence for the D-01 no-phone-home prohibition"
affects: [14-03, 14-04, 14-05, 14-06, 14-07, 14-09, 14-16]

estimate:
  tokens: 70000
  raw_tokens: 70000
  tasks: 3
  confidence: low
actuals:
  tokens: 17400
  tasks: 3
  commits: 0

tech-stack:
  added: []
  patterns:
    - "Pure Prisma-free licence module consumed by service, provider tool and fixtures through one format.ts"
    - "Signature checked over exact ASCII bytes before any JSON parse (no canonicalisation)"
    - "One-shot golden-vector generator that refuses to run twice and never writes a private key"

key-files:
  created:
    - src/server/licence/constants.ts
    - src/server/licence/errors.ts
    - src/server/licence/format.ts
    - src/server/licence/trust-set.ts
    - src/server/licence/verify.ts
    - tests/support/licence-fixtures.ts
    - tests/support/generate-licence-golden-vectors.ts
    - tests/licence-format.test.ts
    - tests/licence-verify.test.ts
    - tests/licence-purity.test.ts
    - tests/fixtures/licence/schema-1/manifest.json
    - tests/fixtures/licence/schema-1/valid-active.lic
    - tests/fixtures/licence/schema-1/valid-grace.lic
    - tests/fixtures/licence/schema-1/expired.lic
    - tests/fixtures/licence/schema-1/retired-key.lic
    - tests/fixtures/licence/schema-1/revoked-key.lic
    - tests/fixtures/licence/schema-1/unknown-key.lic
    - tests/fixtures/licence/schema-1/wrong-deployment.lic
    - tests/fixtures/licence/schema-1/tampered-payload.lic
    - tests/fixtures/licence/schema-1/unsupported-prefix.lic
    - tests/fixtures/licence/schema-1/unsupported-schema.lic
  modified: []

key-decisions:
  - "encodeLicenceEnvelope takes the signature as bytes or as a function of the signed input, because the signature depends on the encoded header and payload; this keeps one encoder for signer and verifier."
  - "An unrecognised integer payload schemaVersion is reported as UNSUPPORTED_SCHEMA before the v1 payload shape is enforced, so a future-schema licence is not misreported as BAD_FORMAT."
  - "A malformed shipped trust-set key throws LicenceUnavailableError (configuration fault) instead of returning a rejection code."
  - "Golden vectors are signed by in-memory keys that were discarded; only the public x values live in DEV_TRUSTED_KEYS, so the vectors can be verified but never re-signed."

patterns-established:
  - "Pure-module purity guard that enumerates src/server/licence at test time, so later modules are covered automatically"

requirements-completed: []

coverage:
  - id: LIC-01-verify
    description: "Altered, wrong-deployment, wrong-client, unknown/revoked key, unsupported schema and malformed licences each return exactly one closed-set code; valid and retired-key licences verify"
    requirement: "LIC-01"
    verification:
      - kind: test
        ref: "tests/licence-verify.test.ts, tests/licence-format.test.ts (78 tests across three files pass)"
        status: pass
    human_judgment: false
  - id: LIC-01-purity
    description: "No module under src/server/licence imports a network-capable or request-bound module or calls fetch (D-01 prohibition)"
    requirement: "LIC-01"
    verification:
      - kind: test
        ref: "tests/licence-purity.test.ts"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-10-01
status: complete
---

# Phase 14 Plan 02: Signed-Licence Contract Summary

**Pure Ed25519 licence verifier over the owner-approved compact LMS-LIC1 envelope, with a versioned trust set, a shared encoder, ten locked golden vectors and an executable no-network purity guard.**

## Performance

- **Duration:** about 35 min
- **Completed:** 2026-10-01
- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 auto, all TDD)
- **Files created:** 21 (5 source modules, 2 support files, 3 test files, 10 vectors plus manifest)

## Accomplishments

- Tracer: a licence minted by the fixture through the same `encodeLicenceEnvelope` the verifier family uses verifies end to end (envelope parse, signature over the exact ASCII bytes, payload parse) and returns four Date-typed fields. Verified end to end before any expansion (tracer feedback gate: automated-only verify re-run, passed).
- `verifyLicence` pins `alg` to the literal Ed25519, resolves `kid` in an injected trust set (`UNKNOWN_KEY`, `KEY_REVOKED`, retired keys still verify), checks the signature before any payload JSON is parsed, then applies `UNSUPPORTED_SCHEMA`, `WRONG_DEPLOYMENT`, `WRONG_CLIENT` and the activate-only `NOT_YET_VALID` (10 minute tolerance, exact boundary tested). It never compares the clock to `expiresAt` or `graceEndsAt` (D-10, D-11) and does not evaluate `notBefore` in runtime mode (D-12).
- Envelope parser enforces the 8192-character cap and `A-Za-z0-9._-` alphabet before decoding (8192 accepted, 8193 rejected), reports an unrecognised `LMS-LIC{n}` prefix as `UNSUPPORTED_SCHEMA` and any other wrong prefix as `BAD_FORMAT`.
- Tolerant reader: unknown optional payload members are stripped; a missing required member, malformed instant, unknown time zone or violated date order is `BAD_FORMAT`; `expiresAt == graceEndsAt` is accepted.
- Ten golden vectors under `tests/fixtures/licence/schema-1/` with a manifest, produced by a one-shot generator that refuses to run twice (tested by spawning it) and never writes a private key (tested by a `PRIVATE KEY` substring scan over fixtures and support files).
- `PRODUCTION_TRUSTED_KEYS` is empty; `loadTrustSet` excludes the development keys when NODE_ENV is production (tested: the golden active licence returns `UNKNOWN_KEY` under a production trust set).

## Task Commits

None. Commit: none (owner policy: commits only on explicit request). All changes remain in the working tree.

1. Task 1 (tracer): constants, errors, format, trust-set (builder), verify, fixtures, 17 verifier tests. Commit: none (owner policy)
2. Task 2: trust-set loaders and key lists, generator, ten vectors, golden/loader/hygiene tests (35 tests in the file). Commit: none (owner policy)
3. Task 3: format edge tests and purity guard. Commit: none (owner policy)

## Verification Results (real output)

- `npx vitest run tests/licence-format.test.ts tests/licence-purity.test.ts tests/licence-verify.test.ts`: 3 files passed, 78 tests passed, 0 failed (also run with `--project node`).
- `npx eslint src/server/licence tests/support/licence-fixtures.ts tests/support/generate-licence-golden-vectors.ts tests/licence-format.test.ts tests/licence-purity.test.ts tests/licence-verify.test.ts`: exit 0, no output.
- `npx tsc --noEmit`: 15 errors, all pre-existing and unrelated (tests/identity-security.integration.test.ts, tests/learner-journey.integration.test.ts, tests/payment-reconciliation.integration.test.ts, stale generated Prisma client types). Zero errors mention any licence file (`grep -i licence` over the tsc output returns nothing).

## Files Created/Modified

See key-files. No existing file was modified by this plan.

## Decisions Made

See key-decisions. Contract member names, limits and rules follow 14-DECISIONS.md "D-02 contract decision" (option-a, no edits) exactly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] verify call split across lines failed the literal-text acceptance criterion**
- **Found during:** Task 1 first test run
- **Issue:** the first formatting of the one-shot verify call put `verify(` and `null,` on separate lines, so the acceptance criterion (source contains the literal `verify(null,`) failed.
- **Fix:** decoded the signed and signature bytes first, then made the call on one line.
- **Files modified:** src/server/licence/verify.ts
- **Commit:** none (owner policy)

### Judgement calls within the plan's intent (not rule violations)

- `encodeLicenceEnvelope` accepts the signature as bytes or as a function of the signed input. The plan's `{ header, payload, signature }` shape cannot sign over bytes that depend on the encoding it performs, so a callback form was added; byte form covers the "unsigned" and "wrong signature" test cases.
- Payload schema version is checked on the raw parsed JSON before the v1 shape is enforced (see key-decisions). Observable results for every case listed in the plan are identical.
- Extra non-contract exports were added alongside the required ones: `ParsedEnvelope`, `LicenceHeader`, `LicencePayload`, `LicenceSignature`, `VerifyResult`, `defaultFixturePayload`. The manifest entries also carry a `description` field beside `file`, `expect`, `mode`.
- The purity test additionally rejects dynamic `import()` calls and asserts the detectors are not vacuous.
- The `actuals.tokens` figure (about 17,400) is chars/4 over the final content of the created files and is far below the plan's 70,000 estimate, so the estimate was high for this scope.

## Auth Gates

None.

## Known Stubs

None. `PRODUCTION_TRUSTED_KEYS` is intentionally empty by design (D-03, filled by a provider code release after keygen); it is an asserted contract, not an unwired stub.

## Threat Flags

None. No network endpoint, auth path, file-access path or schema change was added. Threat register mitigations T-14-02-01 to T-14-02-06 are covered by tests as listed in the plan.

## Issues Encountered

None beyond the Deviation above. tsc reports 15 pre-existing errors in unrelated integration tests (stale generated Prisma client types); out of scope, not touched.

## Next Phase Readiness

Plan 14-04 (state derivation) can import the constants, `verifyLicence`, `VerifiedLicence` and the error classes. Plan 14-05 (provider tool) can import `encodeLicenceEnvelope`, the schemas and `buildSignedInput` from `@/server/licence/format` (relative imports are used inside the module, so it also loads under `tsx`). Every later plan that adds a file under `src/server/licence` is covered automatically by `tests/licence-purity.test.ts`.

## Self-Check: PASSED

- FOUND on disk: src/server/licence/{constants,errors,format,trust-set,verify}.ts; tests/support/{licence-fixtures,generate-licence-golden-vectors}.ts; tests/licence-{format,verify,purity}.test.ts; tests/fixtures/licence/schema-1/manifest.json and the ten .lic vectors.
- Commits: none by owner policy; no git add, commit, stash, reset, clean or checkout was run.
