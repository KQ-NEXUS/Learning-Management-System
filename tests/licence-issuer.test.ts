/**
 * Provider-side licence issuer (plan 14-05, D-03).
 *
 * Every key is a throwaway generated under os.tmpdir() and removed in afterAll;
 * no key material is ever written inside the repository. The PEM marker text is
 * assembled at runtime so this file itself never contains it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertOutsideRepo,
  generateKeyPairToFile,
  inspectLicence,
  issueLicence,
  loadPrivateKey,
} from "../provider-tools/licence-issuer/issue";
import { DAY_MS } from "@/server/licence/constants";
import { buildTrustSet } from "@/server/licence/trust-set";
import { verifyLicence } from "@/server/licence/verify";
import { runtimeImports } from "./import-graph";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const CLI = "provider-tools/licence-issuer/cli.ts";
const PRIVATE_KEY_MARKER = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "licence-issuer-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

const ISSUED_AT = new Date("2026-10-01T00:00:00.000Z");
const EXPIRES_AT = new Date("2027-01-01T00:00:00.000Z");
const NOW = new Date("2026-10-01T12:00:00.000Z");
const DEPLOYMENT_ID = "deployment-issuer-0001";

function baseInput(privateKey: ReturnType<typeof loadPrivateKey>, kid: string) {
  return {
    privateKey,
    kid,
    licenceId: "LIC-2026-0001",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    client: { id: "client-0001", name: "Issuer Test Academy" },
    deploymentId: DEPLOYMENT_ID,
    timeZone: "Africa/Lagos",
    support: { renewalEmail: "renewals@provider.example", supportEmail: "support@provider.example" },
  };
}

function setup(name: string) {
  const keyPath = path.join(tmpDir, `${name}.pem`);
  const generated = generateKeyPairToFile({ kid: `kid-${name}`, outPath: keyPath });
  return { keyPath, generated, privateKey: loadPrivateKey(keyPath) };
}

function trustSetFor(kid: string, x: string) {
  return buildTrustSet([{ kid, x, status: "active" }]);
}

function payloadOf(raw: string): Record<string, string> {
  return inspectLicence(raw).payload as Record<string, string>;
}

describe("licence issuer tracer: generate, issue, verify (D-02, D-03)", () => {
  it("generateKeyPairToFile writes a PKCS#8 PEM outside the repository and loadPrivateKey reads it back", () => {
    const keyPath = path.join(tmpDir, "tracer.pem");
    const result = generateKeyPairToFile({ kid: "kqn-test-a", outPath: keyPath });

    expect(result.kid).toBe("kqn-test-a");
    expect(result.publicJwkX).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.trustSetEntry).toEqual({ kid: "kqn-test-a", x: result.publicJwkX, status: "active" });

    // The key file is under os.tmpdir() and outside the repository, and is a PEM.
    expect(isInside(os.tmpdir(), keyPath)).toBe(true);
    expect(isInside(REPO_ROOT, keyPath)).toBe(false);
    const pem = readFileSync(keyPath, "utf8");
    expect(pem.startsWith("-----BEGIN")).toBe(true);

    // The return value never carries the private key.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("PRIVATE");
    expect(serialised).not.toContain(pem.split("\n")[1] ?? "unreachable");

    const key = loadPrivateKey(keyPath);
    expect(key.type).toBe("private");
    expect(key.asymmetricKeyType).toBe("ed25519");
  });

  it("an issued licence verifies with the LMS verifier and grace defaults to 14 UTC days", () => {
    const { generated, privateKey } = setup("verify");
    const raw = issueLicence(baseInput(privateKey, generated.kid));

    const result = verifyLicence(raw, {
      trustSet: trustSetFor(generated.kid, generated.publicJwkX),
      deploymentId: DEPLOYMENT_ID,
      registeredClientId: null,
      now: NOW,
      mode: "activate",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.licence.licenceId).toBe("LIC-2026-0001");
    expect(result.licence.clientId).toBe("client-0001");
    expect(result.licence.keyId).toBe(generated.kid);

    const payload = payloadOf(raw);
    expect(Date.parse(payload.graceEndsAt) - Date.parse(payload.expiresAt)).toBe(14 * DAY_MS);
    expect(payload.notBefore).toBe(payload.issuedAt);
    expect(payload.schemaVersion).toBe(1);
  });

  it("graceDays 30 and 0 are honoured exactly in 24-hour UTC days", () => {
    const { generated, privateKey } = setup("grace");
    const thirty = payloadOf(issueLicence({ ...baseInput(privateKey, generated.kid), graceDays: 30 }));
    expect(Date.parse(thirty.graceEndsAt) - Date.parse(thirty.expiresAt)).toBe(30 * DAY_MS);
    const none = payloadOf(issueLicence({ ...baseInput(privateKey, generated.kid), graceDays: 0 }));
    expect(none.graceEndsAt).toBe(none.expiresAt);
  });

  it("a licence signed by another key or for another deployment is rejected by the verifier", () => {
    const first = setup("other-a");
    const second = setup("other-b");
    const raw = issueLicence(baseInput(first.privateKey, first.generated.kid));
    const context = {
      registeredClientId: null,
      now: NOW,
      mode: "activate" as const,
    };
    expect(
      verifyLicence(raw, {
        ...context,
        trustSet: trustSetFor(first.generated.kid, second.generated.publicJwkX),
        deploymentId: DEPLOYMENT_ID,
      }),
    ).toEqual({ ok: false, code: "BAD_SIGNATURE" });
    expect(
      verifyLicence(raw, {
        ...context,
        trustSet: trustSetFor(first.generated.kid, first.generated.publicJwkX),
        deploymentId: "some-other-deployment",
      }),
    ).toEqual({ ok: false, code: "WRONG_DEPLOYMENT" });
  });

  it("issueLicence fails before signing on bad dates, grace, time zone and licence id", () => {
    const { generated, privateKey } = setup("bad-input");
    const input = baseInput(privateKey, generated.kid);

    expect(() => issueLicence({ ...input, expiresAt: ISSUED_AT })).toThrow(/after issuedAt/);
    expect(() => issueLicence({ ...input, expiresAt: new Date(ISSUED_AT.getTime() - 1) })).toThrow();
    expect(() => issueLicence({ ...input, graceDays: -1 })).toThrow(/graceDays/);
    expect(() => issueLicence({ ...input, graceDays: 1.5 })).toThrow(/graceDays/);
    expect(() => issueLicence({ ...input, timeZone: "Mars/Olympus_Mons" })).toThrow();
    expect(() => issueLicence({ ...input, licenceId: "bad id!" })).toThrow();
    expect(() => issueLicence({ ...input, licenceId: "has/slash" })).toThrow();
    expect(() => issueLicence({ ...input, issuedAt: new Date("not a date") })).toThrow(/issuedAt/);
    expect(() => issueLicence({ ...input, kid: "bad kid" })).toThrow();
    expect(() => issueLicence({ ...input, notBefore: new Date(EXPIRES_AT.getTime() + 1) })).toThrow();
  });

  it("the CLI keygen, issue, verify and inspect commands work end to end and never print the key", () => {
    const quote = (value: string) => `"${value}"`;
    const run = (args: string[], expectStatus = 0) => {
      try {
        return {
          status: 0,
          stdout: execFileSync("npx", ["tsx", CLI, ...args], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            shell: true,
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 90_000,
          }),
        };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        if (failure.status === expectStatus) {
          return { status: failure.status ?? -1, stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
        }
        throw error;
      }
    };

    const keyPath = path.join(tmpDir, "cli.pem");
    const licencePath = path.join(tmpDir, "cli.lic");

    const keygen = run(["keygen", "--kid", "kqn-cli-a", "--out", quote(keyPath)]);
    expect(keygen.stdout).toContain("kqn-cli-a");
    expect(keygen.stdout).not.toContain("PRIVATE KEY");
    const pemBody = readFileSync(keyPath, "utf8").split("\n")[1] ?? "unreachable";
    expect(keygen.stdout).not.toContain(pemBody);
    const x = /public JWK x:\s+(\S+)/.exec(keygen.stdout)?.[1];
    expect(x).toBeTruthy();

    const issue = run([
      "issue",
      "--key", quote(keyPath),
      "--kid", "kqn-cli-a",
      "--licence-id", "LIC-CLI-0001",
      "--client-id", "client-cli-0001",
      "--client-name", quote("CLI Test Academy"),
      "--deployment-id", DEPLOYMENT_ID,
      "--issued", "2026-09-30T00:00:00Z",
      "--expires", "2099-01-01T00:00:00Z",
      "--renewal-email", "renewals@provider.example",
      "--support-email", "support@provider.example",
      "--out", quote(licencePath),
    ]);
    expect(issue.stdout).not.toContain(pemBody);
    expect(issue.stdout).toContain("2099-01-15T00:00:00.000Z");
    expect(existsSync(licencePath)).toBe(true);

    const verify = run([
      "verify", quote(licencePath),
      "--kid", "kqn-cli-a",
      "--public-x", x as string,
      "--deployment-id", DEPLOYMENT_ID,
    ]);
    expect(verify.stdout).toContain("OK");

    const wrong = run(
      ["verify", quote(licencePath), "--kid", "kqn-cli-a", "--public-x", x as string, "--deployment-id", "elsewhere"],
      1,
    );
    expect(wrong.stdout).toContain("REJECTED: WRONG_DEPLOYMENT");

    const inspect = run(["inspect", quote(licencePath)]);
    expect(inspect.stdout).toContain("LIC-CLI-0001");
    expect(inspect.stdout).toContain("CLI Test Academy");
    expect(inspect.stdout).toContain(DEPLOYMENT_ID);
    expect(inspect.stdout).toContain("2026-09-30T00:00:00.000Z");
    expect(inspect.stdout).toContain("2099-01-01T00:00:00.000Z");
    expect(inspect.stdout).toContain("2099-01-15T00:00:00.000Z");

    // A second keygen to the same path is refused, and an unknown command exits non-zero.
    const overwrite = run(["keygen", "--kid", "kqn-cli-a", "--out", quote(keyPath)], 1);
    expect(overwrite.stdout).toContain("overwrite");
    const unknown = run(["frobnicate"], 2);
    expect(unknown.stdout).toContain("Usage");
  }, 180_000);
});

describe("licence issuer key-custody guards (D-03, T-14-05-01)", () => {
  it("assertOutsideRepo rejects the repository root, paths inside it and relative paths resolving inside it", () => {
    expect(() => assertOutsideRepo(REPO_ROOT)).toThrow(/inside the repository/);
    expect(() => assertOutsideRepo(path.join(REPO_ROOT, "provider-tools", "x.pem"))).toThrow();
    expect(() => assertOutsideRepo(path.join(REPO_ROOT, "does", "not", "exist.pem"))).toThrow();
    const relative = path.relative(process.cwd(), path.join(REPO_ROOT, "relative-probe.pem"));
    expect(() => assertOutsideRepo(relative)).toThrow();
    expect(() => assertOutsideRepo(path.join(tmpDir, "inside-tmp.pem"))).not.toThrow();
  });

  it("generateKeyPairToFile refuses an existing file and a repository path; loadPrivateKey refuses a repository path", () => {
    const keyPath = path.join(tmpDir, "exists.pem");
    generateKeyPairToFile({ kid: "kqn-guard-a", outPath: keyPath });
    const before = readFileSync(keyPath, "utf8");
    expect(() => generateKeyPairToFile({ kid: "kqn-guard-a", outPath: keyPath })).toThrow(/overwrite/);
    expect(readFileSync(keyPath, "utf8")).toBe(before);

    const repoPath = path.join(REPO_ROOT, "licence-guard-probe.pem");
    expect(() => generateKeyPairToFile({ kid: "kqn-guard-b", outPath: repoPath })).toThrow(/inside the repository/);
    expect(existsSync(repoPath)).toBe(false);
    expect(() => loadPrivateKey(path.join(REPO_ROOT, "package.json"))).toThrow(/inside the repository/);

    expect(() => generateKeyPairToFile({ kid: "bad kid!", outPath: path.join(tmpDir, "bad-kid.pem") })).toThrow(
      /key id/,
    );
  });

  it("the Docker build context excludes provider-tools", () => {
    const lines = readFileSync(path.join(REPO_ROOT, ".dockerignore"), "utf8").split(/\r?\n/);
    expect(lines).toContain("provider-tools");
  });

  it("no file under provider-tools holds private-key text, and no src or netlify file imports provider-tools", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });

    const providerFiles = walk(path.join(REPO_ROOT, "provider-tools"));
    expect(providerFiles.length).toBeGreaterThanOrEqual(4);
    for (const file of providerFiles) {
      expect(readFileSync(file, "utf8").includes(PRIVATE_KEY_MARKER), file).toBe(false);
    }

    const sources = [...walk(path.join(REPO_ROOT, "src")), ...walk(path.join(REPO_ROOT, "netlify"))].filter(
      (file) => /\.(ts|tsx|mts|mjs|js|jsx)$/.test(file),
    );
    expect(sources.length).toBeGreaterThan(50);
    const offenders = sources.filter((file) =>
      runtimeImports(file).some((entry) => entry.specifier.includes("provider-tools")),
    );
    expect(offenders).toEqual([]);

    // Non-vacuous: a probe file that does import provider-tools is flagged.
    const probe = path.join(tmpDir, "probe.ts");
    writeFileSync(probe, 'import { issueLicence } from "../provider-tools/licence-issuer/issue";\n');
    expect(runtimeImports(probe).some((entry) => entry.specifier.includes("provider-tools"))).toBe(true);
  });

  it("RUNBOOK.md has the required lifecycle sections and the owner-approved terminology", () => {
    const runbook = readFileSync(path.join(REPO_ROOT, "provider-tools/licence-issuer/RUNBOOK.md"), "utf8");
    const headings = runbook
      .split(/\r?\n/)
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());
    for (const required of [
      "Issue",
      "Renew",
      "Replace",
      "Key rotation",
      "Compromise recovery",
      "Time rules",
      "Source handover",
      "Adding the production public key",
    ]) {
      expect(headings, `missing heading ${required}`).toContain(required);
    }
    expect(runbook).toContain("restricted continuity mode");
    expect(runbook).toContain("UNKNOWN_KEY");
    expect(runbook).toContain("KEY_REVOKED");
    expect(runbook).toMatch(/revocation before expiry is not possible/i);
  });
});
