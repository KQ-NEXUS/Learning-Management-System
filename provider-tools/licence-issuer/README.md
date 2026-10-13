# Licence issuer (provider-side only)

Warning: this directory is for the provider only. It is excluded from Docker images (`.dockerignore`), must not ship to a client, and must never be imported by `src` or `netlify` code. The private signing key must never be placed in the repository; the tool refuses any key path inside it.

It signs through the same format module the LMS verifier uses (`src/server/licence/format.ts`), so a licence it issues verifies in the LMS. Full procedures are in `RUNBOOK.md`.

Run every command from the repository root:

```
npx tsx provider-tools/licence-issuer/cli.ts <command> [options]
```

## keygen

Create an Ed25519 key. The private key is written to a path outside the repository (never overwritten, never printed); the public `x` value and a trust-set entry are printed.

```
npx tsx provider-tools/licence-issuer/cli.ts keygen --kid kqn-2026-a --out D:/provider-vault/kqn-2026-a.pem
```

## issue

Sign a licence file. Grace defaults to 14 days of 24 hours in UTC after `--expires`.

```
npx tsx provider-tools/licence-issuer/cli.ts issue --key D:/provider-vault/kqn-2026-a.pem --kid kqn-2026-a --licence-id LIC-2026-0001 --client-id client-0001 --client-name "Example Academy" --deployment-id <id from the client's Licence screen> --expires 2027-01-31T23:59:59Z --renewal-email renewals@provider.example --support-email support@provider.example --out ./example-academy.lic
```

Optional: `--issued`, `--not-before`, `--grace-days`, `--time-zone` (default `Africa/Lagos`), `--phone`, `--hours`.

## verify

Check a file with the public key, using the LMS verifier. Prints `OK` or the rejection code.

```
npx tsx provider-tools/licence-issuer/cli.ts verify ./example-academy.lic --kid kqn-2026-a --public-x <x from keygen> --deployment-id <id> [--client-id <id>]
```

## inspect

Print the header and payload without checking the signature (display only; use `verify` to trust a file).

```
npx tsx provider-tools/licence-issuer/cli.ts inspect ./example-academy.lic
```
