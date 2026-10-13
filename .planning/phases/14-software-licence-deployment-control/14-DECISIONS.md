# Phase 14 Decisions

Human decision record for the two one-way doors of Phase 14 (Software Licence & Deployment Control), the adopted-assumptions ledger, and the edge/prohibition index. Source: plan 14-01. Both decisions were answered by the project owner on 2026-10-01 through the orchestrator question UI. Fixed frame, not reopened by either decision: D-01 (local-only verification), D-04 (24-hour local-failure window), D-13 (DB-held state).

## D-02 contract decision

**Reversibility:** one-way (every issued licence embeds this envelope and key-ID scheme).

**Owner reply (verbatim):** `option-a` (UI label shown: "option-a: compact envelope (Recommended)"). No edits requested.

**Meaning:** the proposed compact envelope contract is approved exactly as written in plan 14-01 Task 1 (schema version 1):

- Envelope: one ASCII line `LMS-LIC1.{header}.{payload}.{signature}`, each part base64url without padding; maximum 8192 characters; allowed characters `A-Za-z0-9._-` only.
- Signed bytes: the exact ASCII string `LMS-LIC1.{header}.{payload}`; signature verified before any JSON parsing; no canonicalisation step.
- Header JSON members: `alg` (exactly `Ed25519`), `kid` (1 to 64 characters `A-Za-z0-9._-`), `typ` (`lms-licence`), `v` (1).
- Payload JSON members, all signed: `schemaVersion` (1), `licenceId` (unique per issued file), `issuedAt`, `notBefore`, `expiresAt`, `graceEndsAt` (ISO-8601 UTC instants ending in Z), `client` (`id`, `name`), `deploymentId`, `timeZone` (IANA, display only), `support` (`renewalEmail`, `supportEmail`, optional `phone`, `hours`).
- Date rules: `notBefore` <= `expiresAt`, `expiresAt` <= `graceEndsAt`, `issuedAt` <= `expiresAt`. Grace is a generator input (default 14 days of 24 hours in UTC), never computed by the LMS.
- Tolerant reader: unknown optional payload members ignored; a new required member needs `schemaVersion` 2 and a new envelope prefix; an unrecognised `LMS-LIC{n}` prefix is reported as an unsupported schema, not a bad format.
- Key-ID scheme: versioned trust set with statuses `active` (signs and verifies), `retired` (verifies only), `revoked` (rejected); development keys trusted only when NODE_ENV is not production.
- Binding: first activation pins `client.id` (A5); `deploymentId` must equal the database-seeded value (D-13); activation rejects an `issuedAt` not newer than the newest recorded one unless it is the same `licenceId` (A7).

**Edit list:** none (option-a, no option-c edits).

**Read by:** plans 14-02 and 14-05 read this contract decision before writing `src/server/licence/format.ts` and the provider tool.

## OQ1 never-activated decision

**Reversibility:** one-way (the first licence-enforced release fixes whether existing and pilot deployments keep running unlicensed).

**Owner reply (verbatim):** `option-a` (UI label shown: "option-a: operational until first activation (Recommended)").

**Meaning:** a deployment that has never activated a licence is fully operational (state `UNLICENSED`, never restricted). The first successful activation flips a permanent `everActivated` flag, after which enforcement is permanent. The schema shape is identical for every option; only state derivation and the single policy constant differ. Plan 14-04 MUST implement this answer as the policy constant `NEVER_ACTIVATED_POLICY` (value for option-a: fully operational until first activation, then enforcement permanent via `everActivated`). The migration default seeds `LicenceState` with `everActivated = false` and `state = UNLICENSED`, and the UI-SPEC empty-state copy and "not activated" pill stand as approved. The commercial agreement (PRD section 18.1) is the control for a client that never activates.

**Read by:** plans 14-03 (migration default), 14-04 (`deriveState` and `NEVER_ACTIVATED_POLICY`) and 14-06 read this OQ1 decision.

## Adopted assumptions ledger

Every row below is adopted at the RESEARCH-recommended default. None is a locked decision; each stays visible here so it can be redirected. Source: 14-RESEARCH.md Open Questions and Assumptions Log.

| Id | Default adopted | Plan that depends on it | How to redirect |
| --- | --- | --- | --- |
| OQ2 | Licence ID is per issued file (unique), ordered by `issuedAt`; notice dedupe keys renew naturally on replacement | 14-02 | Reply in the next planning or execution session with the replacement default |
| OQ3 | The seeded Administrator role keeps `licence.activate` through the full permission spread (`[...PERMISSIONS]`), deviating from PRD 18.4 "deliberately restricted"; the deviation is documented and proven by a restricted-state activation test | 14-15, 14-21 | Reply in the next planning or execution session with the replacement default |
| OQ4 and A13 | Manual payment confirmation after restriction is allowed only for orders created before the restriction | 14-13 | Reply in the next planning or execution session with the replacement default |
| OQ5 and A3 | Hosting: the design tolerates both Docker Compose and Netlify because restriction is derived on every guarded write and needs no scheduler; alert delivery needs a scheduler; the startup hook (`instrumentation.ts register()`) is best effort | 14-16 | Reply in the next planning or execution session with the replacement default |
| OQ6 and A15 | Provider tool lives in-repo under `provider-tools/`, excluded from the Docker context; a source handover ships the repo without it (runbook note) | 14-05 | Reply in the next planning or execution session with the replacement default |
| OQ7 | The `.docx` twins of the PRD and PXR are regenerated by the owner after the `.md` edits | 14-20 | Reply in the next planning or execution session with the replacement default |
| OQ8 and A12 | Learner copy during restriction is the neutral sentence "Enrolment is temporarily unavailable. Please contact support."; new registration is blocked; sign-in, verify and reset stay allowed; no licence wording reaches learners | 14-12 | Reply in the next planning or execution session with the replacement default |
| A4 | 60-day expiring-soon window, 3-day grace-ending notice, hourly scheduled cadence | 14-16 | Reply in the next planning or execution session with the replacement default |
| A5 | Wrong-client is enforced by pinning `client.id` at first activation (trust on first activation) | 14-07 | Reply in the next planning or execution session with the replacement default |
| A7 | Anti-replay: activation rejects an `issuedAt` older than the greatest recorded one unless it is the same `licenceId` | 14-07 | Reply in the next planning or execution session with the replacement default |
| A8 | Development trust keys are trusted only when NODE_ENV is not production | 14-02 | Reply in the next planning or execution session with the replacement default |
| A9 | `attendance.manage` and staff progress override (`overrideLessonProgress`) are continuity (progress recording) | 14-17 | Reply in the next planning or execution session with the replacement default |
| A10 | Staff deactivation is continuity (security administration); staff creation and reactivation are blocked | 14-17 | Reply in the next planning or execution session with the replacement default |
| A11 | Support tickets (learner and staff) remain available in restricted continuity mode | 14-17 | Reply in the next planning or execution session with the replacement default |
| A12 | See OQ8 and A12 row: new learner registration blocked, sign-in/verify/reset allowed | 14-12 | Reply in the next planning or execution session with the replacement default |
| A13 | See OQ4 and A13 row: manual payment confirmation only for orders created before the restriction | 14-13 | Reply in the next planning or execution session with the replacement default |
| A14 | Enforcement audit denials are coalesced to one row per actor per minute per process | 14-09 | Reply in the next planning or execution session with the replacement default |
| A15 | See OQ6 and A15 row: `.dockerignore` exclusion plus runbook note keeps `provider-tools/` out of a client handover | 14-05 | Reply in the next planning or execution session with the replacement default |

## Edge coverage and prohibition index

Per owning plan, so no probe-surfaced item is silently dropped.

| Owning plan | Item | Kind |
| --- | --- | --- |
| 14-04 and 14-07 | LIC-05 boundary, precision and concurrency (explicit truths) | Edge coverage |
| 14-02 | LIC-01 (unclassified, review manually) | Edge coverage |
| 14-10 | LIC-02 (unclassified, review manually) | Edge coverage |
| 14-15 | LIC-03 (unclassified, review manually) | Edge coverage |
| 14-16 | LIC-04 (unclassified, review manually) | Edge coverage |
| 14-09 | LIC-06 (unclassified, review manually) | Edge coverage |
| 14-14 | LIC-07 (unclassified, review manually) | Edge coverage |
| 14-21 | LIC-08 (unclassified, review manually) | Edge coverage |
| 14-02 | P1: no phone-home and no kill switch | Prohibition |
| 14-12 | P2: no licence wording shown to learners | Prohibition |
| 14-21 | P3: no data deletion and no database-wide read-only switch | Prohibition |
| 14-09 | P4: no lock-out of recovery on clock anomaly | Prohibition |
| 14-14 | P5: notices go only to Global `licence.view` holders, without signing, contract or deployment detail | Prohibition |
