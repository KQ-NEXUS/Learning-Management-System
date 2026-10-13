# Licence issuer runbook

Provider-side procedure for issuing, renewing, replacing and recovering software licences for the LMS. This directory is for the provider only. It is excluded from Docker images and must not be shipped to a client.

All commands run from the repository root as `npx tsx provider-tools/licence-issuer/cli.ts <command>`. See `README.md` for one example of each command.

## Purpose and custody

A licence is one ASCII line (`LMS-LIC1.{header}.{payload}.{signature}`) signed with an Ed25519 key. The LMS verifies it locally against public keys built into the release. There is no online validator (D-01).

- The private signing key lives only in the provider vault or a hardware module. It never exists in the repository, configuration, backups or any UI.
- `keygen` writes the key to a path you choose outside the repository and refuses a path inside it. `issue` refuses to read a key from inside the repository. `keygen` also refuses to overwrite an existing file.
- No command prints the private key. Only the public key (the `x` value) and the trust-set entry are printed.
- Keep an offline copy of the key in a second secure location. If the key is lost, no new licence can be issued under it and a key rotation is required.
- Keep your own register of every licence you issue (licence id, client, deployment id, dates). The LMS repository stores nothing about issued files.

## Adding the production public key

Run `keygen` once per signing key, with a key id such as `kqn-2026-a`:

```
npx tsx provider-tools/licence-issuer/cli.ts keygen --kid kqn-2026-a --out <path outside the repository>
```

Copy the printed trust-set entry (`{"kid":"kqn-2026-a","x":"...","status":"active"}`) into `PRODUCTION_TRUSTED_KEYS` in `src/server/licence/trust-set.ts` and ship it in a normal release.

The production public key is not in the repository today. Until this release ships, every production licence is rejected as `UNKNOWN_KEY`, so a deployment cannot be licensed before then. Development keys are trusted only outside production and cannot be used to license a production deployment.

## Issue

1. Ask the client for the deployment ID shown on the Licence and System Status screen, and agree the client identifier (the stable `client.id` for this client).
2. Choose a fresh, unique licence id for this file (characters `A-Z a-z 0-9 . _ -`, at most 64).
3. Run `issue` with the key path, key id, licence id, client id and name, deployment id, expiry instant, support contacts and an output path. The expiry is an ISO-8601 instant with `Z` or an offset.
4. Run `verify` on the file with the public key and deployment id to confirm it, then send the file to the client.

The client identifier is pinned at first activation. After that, any licence for a different client identifier is rejected as `WRONG_CLIENT`, so use the same identifier for every later licence for that client.

## Renew

A renewal is a new file, not an edit of the old one.

1. Issue a replacement with a newer `--issued` instant, a new licence id, the same client id and the same deployment id.
2. Set `--not-before` equal to `--issued` (the default) so an early activation works before the old term ends.
3. The client rejects any file whose `issuedAt` is not newer than the newest one recorded, unless it is the same licence id. Re-sending an older file is refused (`OLDER_THAN_ACTIVE`); re-uploading the file already active is reported as `ALREADY_ACTIVE`.

## Replace

Use the same procedure as Renew to correct a mistake (wrong support contact, wrong expiry) or to shorten a term.

Revocation before expiry is not possible without an online validator (D-01). The only tool is a replacement with a newer `issuedAt` and, if the term must end sooner, an earlier expiry. The client must activate the replacement for it to take effect.

## Key rotation

1. Run `keygen` with a new key id and add its entry to the trust set as `active`.
2. In the same release, change the old key from `active` to `retired`. Retired keys still verify, so licences already issued keep working.
3. Issue every new licence under the new key id.
4. Remove a retired key only when no deployment holds an unexpired licence signed by it.

## Compromise recovery

If a private key may have been exposed:

1. Run `keygen` for a replacement key and add it as `active`.
2. Mark the compromised key id `revoked` in the trust set and ship a release. Every licence signed by that key then fails as `KEY_REVOKED`, and the deployment enters restricted continuity mode until a licence under a new key id is activated.
3. Tell every affected client before the release ships, then issue and send replacement licences under the new key id.
4. Record the incident and the replacement key id in your provider register.

Restricted continuity mode keeps learning, grading, certificates, payments and exports working; it blocks new commercial use only. It never deletes data.

## Time rules

- `graceEndsAt` equals `expiresAt` plus the grace input in 24-hour days in UTC. The default is 14 days. The generator computes it; the LMS never adds grace itself, so "grace is 14 calendar days" is unambiguous.
- Every licence instant (`issuedAt`, `notBefore`, `expiresAt`, `graceEndsAt`) is an exact UTC instant. The client sees each in its own time zone beside the UTC value; the `timeZone` member is display only.
- The licence contract with the client must state the same rule: expiry is the stated UTC instant, grace is the stated number of 24-hour days after it.
- The signing machine's clock is the reference for `--issued` when it is omitted; pass `--issued` explicitly when preparing a licence in advance.

## Behaviour without a licence

Owner decision OQ1 (recorded in `14-DECISIONS.md`): a deployment that has never activated a licence stays fully operational. The first successful activation sets a permanent flag, after which enforcement is permanent: past the grace end, or after an invalid or missing licence record, the deployment enters restricted continuity mode. The commercial agreement is the control for a client that never activates.

## Source handover

For a self-hosted client handover, ship the repository without the `provider-tools/` directory. `.dockerignore` keeps it out of Docker images. This reduces but does not remove exposure of the generator code; it never concerns the key, which is not in the repository (assumption A15, owner-visible default OQ6). The public verifier code and the trust set remain in the client's source by design.

## Things the generator must never do

- Put a key in configuration, an environment file, a backup or the UI.
- Obfuscate or hide a licence check, or add a hidden check.
- Add a remote kill switch or any call to a provider server.
- Collect telemetry from a deployment.
- Print private key material or accept a key path inside the repository.
