/**
 * Provider-side licence issuer CLI (D-03, plan 14-05).
 *
 * This directory is provider-side only, is excluded from the Docker context
 * (.dockerignore) and from a client source handover, and must never be imported
 * by src or netlify code.
 *
 * Run from the repository root: `npx tsx provider-tools/licence-issuer/cli.ts <command>`.
 * Commands: keygen, issue, verify, inspect. No command prints a private key.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DAY_MS } from "../../src/server/licence/constants";
import { buildTrustSet } from "../../src/server/licence/trust-set";
import { verifyLicence } from "../../src/server/licence/verify";
import {
  DEFAULT_GRACE_DAYS,
  generateKeyPairToFile,
  inspectLicence,
  issueLicence,
  loadPrivateKey,
} from "./issue";

const USAGE = `Licence issuer (provider-side only; never ship this directory to a client)

Usage: npx tsx provider-tools/licence-issuer/cli.ts <command> [options]

Commands:
  keygen   --kid <id> --out <path outside the repository>
  issue    --key <private key path> --kid <id> --licence-id <id>
           --client-id <id> --client-name <name> --deployment-id <id>
           --expires <ISO instant with Z or offset> --renewal-email <email>
           --support-email <email> --out <licence file>
           [--issued <ISO instant, default now>] [--not-before <ISO instant, default issued>]
           [--grace-days <whole days, default ${DEFAULT_GRACE_DAYS}>] [--time-zone <IANA, default Africa/Lagos>]
           [--phone <text>] [--hours <text>]
  verify   <file> --kid <id> --public-x <base64url x> --deployment-id <id> [--client-id <id>]
  inspect  <file>
`;

class UsageError extends Error {}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function required(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new UsageError(`Missing required option --${name}.`);
  }
  return value;
}

function parseInstant(value: string, name: string): Date {
  if (!ISO_WITH_ZONE.test(value)) {
    throw new UsageError(`--${name} must be an ISO-8601 instant with Z or an offset, e.g. 2027-01-31T23:59:59Z.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new UsageError(`--${name} is not a valid date.`);
  return date;
}

function writeNewFile(filePath: string, contents: string): void {
  try {
    writeFileSync(filePath, contents, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Refusing to overwrite an existing licence file; choose a new --out path.");
    }
    throw error;
  }
}

function runKeygen(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { kid: { type: "string" }, out: { type: "string" } },
    strict: true,
  });
  const result = generateKeyPairToFile({ kid: required(values, "kid"), outPath: required(values, "out") });
  console.log("Key pair generated. The private key was written to the path you gave and is not shown.");
  console.log("Store it only in the provider vault or hardware module; never in the repository.");
  console.log(`kid:           ${result.kid}`);
  console.log(`public JWK x:  ${result.publicJwkX}`);
  console.log("Add this entry to PRODUCTION_TRUSTED_KEYS in src/server/licence/trust-set.ts (normal release):");
  console.log(JSON.stringify(result.trustSetEntry));
  return 0;
}

function runIssue(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      key: { type: "string" },
      kid: { type: "string" },
      "licence-id": { type: "string" },
      "client-id": { type: "string" },
      "client-name": { type: "string" },
      "deployment-id": { type: "string" },
      issued: { type: "string" },
      "not-before": { type: "string" },
      expires: { type: "string" },
      "grace-days": { type: "string" },
      "time-zone": { type: "string" },
      "renewal-email": { type: "string" },
      "support-email": { type: "string" },
      phone: { type: "string" },
      hours: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });

  const graceText = values["grace-days"];
  if (graceText !== undefined && !/^\d+$/.test(graceText)) {
    throw new UsageError("--grace-days must be a whole number of days.");
  }
  const issuedAt = values.issued ? parseInstant(values.issued, "issued") : new Date();
  const notBefore = values["not-before"] ? parseInstant(values["not-before"], "not-before") : undefined;
  const expiresAt = parseInstant(required(values, "expires"), "expires");
  const graceDays = graceText === undefined ? DEFAULT_GRACE_DAYS : Number(graceText);

  const licence = issueLicence({
    privateKey: loadPrivateKey(required(values, "key")),
    kid: required(values, "kid"),
    licenceId: required(values, "licence-id"),
    issuedAt,
    notBefore,
    expiresAt,
    graceDays,
    client: { id: required(values, "client-id"), name: required(values, "client-name") },
    deploymentId: required(values, "deployment-id"),
    timeZone: values["time-zone"] ?? "Africa/Lagos",
    support: {
      renewalEmail: required(values, "renewal-email"),
      supportEmail: required(values, "support-email"),
      phone: values.phone,
      hours: values.hours,
    },
  });

  const outPath = required(values, "out");
  writeNewFile(outPath, `${licence}\n`);

  const graceEndsAt = new Date(expiresAt.getTime() + graceDays * DAY_MS);
  console.log(`Licence written: ${outPath}`);
  console.log(`issuedAt     (UTC): ${issuedAt.toISOString()}`);
  console.log(`notBefore    (UTC): ${(notBefore ?? issuedAt).toISOString()}`);
  console.log(`expiresAt    (UTC): ${expiresAt.toISOString()}`);
  console.log(`graceEndsAt  (UTC): ${graceEndsAt.toISOString()}  (expiresAt + ${graceDays} x 24 h)`);
  return 0;
}

function runVerify(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      kid: { type: "string" },
      "public-x": { type: "string" },
      "deployment-id": { type: "string" },
      "client-id": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const file = positionals[0];
  if (!file || positionals.length !== 1) throw new UsageError("verify takes exactly one licence file path.");

  const trustSet = buildTrustSet([
    { kid: required(values, "kid"), x: required(values, "public-x"), status: "active" },
  ]);
  const result = verifyLicence(readFileSync(file, "utf8"), {
    trustSet,
    deploymentId: required(values, "deployment-id"),
    registeredClientId: values["client-id"] ?? null,
    now: new Date(),
    mode: "activate",
  });
  if (!result.ok) {
    console.log(`REJECTED: ${result.code}`);
    return 1;
  }
  console.log(`OK: ${result.licence.licenceId} for ${result.licence.clientName}`);
  return 0;
}

function field(record: unknown, name: string): unknown {
  return typeof record === "object" && record !== null ? (record as Record<string, unknown>)[name] : undefined;
}

function runInspect(argv: string[]): number {
  const { positionals } = parseArgs({ args: argv, options: {}, allowPositionals: true, strict: true });
  const file = positionals[0];
  if (!file || positionals.length !== 1) throw new UsageError("inspect takes exactly one licence file path.");

  const { header, payload, signatureBytes } = inspectLicence(readFileSync(file, "utf8"));
  const client = field(payload, "client");
  console.log("UNVERIFIED contents (the signature was not checked; use the verify command):");
  console.log(`kid:           ${String(field(header, "kid"))}`);
  console.log(`licenceId:     ${String(field(payload, "licenceId"))}`);
  console.log(`client:        ${String(field(client, "name"))} (${String(field(client, "id"))})`);
  console.log(`deploymentId:  ${String(field(payload, "deploymentId"))}`);
  console.log(`timeZone:      ${String(field(payload, "timeZone"))}`);
  for (const name of ["issuedAt", "notBefore", "expiresAt", "graceEndsAt"]) {
    console.log(`${name.padEnd(13)} (UTC): ${String(field(payload, name))}`);
  }
  console.log(`signature:     ${signatureBytes} bytes`);
  return 0;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "keygen":
        return runKeygen(rest);
      case "issue":
        return runIssue(rest);
      case "verify":
        return runVerify(rest);
      case "inspect":
        return runInspect(rest);
      default:
        console.error(USAGE);
        return 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    // parseArgs reports unknown flags as TypeError with a code; treat as usage.
    const isUsage = error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
    console.error(`Error: ${message}`);
    if (isUsage) console.error(`\n${USAGE}`);
    return isUsage ? 2 : 1;
  }
}

process.exitCode = main(process.argv.slice(2));
