import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAY_MS, SKEW_TOLERANCE_MS } from "@/server/licence/constants";
import { LicenceUnavailableError } from "@/server/licence/errors";
import { LICENCE_REJECTION_CODES } from "@/server/licence/format";
import {
  buildTrustSet,
  DEV_TRUSTED_KEYS,
  loadTrustSet,
  PRODUCTION_TRUSTED_KEYS,
} from "@/server/licence/trust-set";
import { verifyLicence, type VerifyContext } from "@/server/licence/verify";
import {
  createFixtureKey,
  FIXTURE_CLIENT,
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  fixtureTrustSet,
  mintLicence,
} from "./support/licence-fixtures";

function ctxFor(
  minted: ReturnType<typeof mintLicence>,
  overrides: Partial<VerifyContext> = {},
): VerifyContext {
  return {
    trustSet: minted.trustSet,
    deploymentId: FIXTURE_DEPLOYMENT_ID,
    registeredClientId: null,
    now: FIXTURE_NOW,
    mode: "activate",
    ...overrides,
  };
}

describe("licence contract constants", () => {
  it("exposes the closed 11-code rejection set in contract order", () => {
    expect([...LICENCE_REJECTION_CODES]).toEqual([
      "BAD_FORMAT",
      "UNSUPPORTED_SCHEMA",
      "UNKNOWN_KEY",
      "KEY_REVOKED",
      "BAD_SIGNATURE",
      "WRONG_DEPLOYMENT",
      "WRONG_CLIENT",
      "NOT_YET_VALID",
      "EXPIRED",
      "OLDER_THAN_ACTIVE",
      "ALREADY_ACTIVE",
    ]);
  });

  it("pins the Ed25519 algorithm and one-shot verify call in the verifier source", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/server/licence/verify.ts"), "utf8");
    expect(source).toContain("verify(null,");
    expect(source).toContain("Ed25519");
  });
});

describe("verifyLicence (tracer)", () => {
  it("verifies a freshly minted licence end to end and returns Date-typed fields", () => {
    const minted = mintLicence();
    const result = verifyLicence(minted.raw, ctxFor(minted));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { licence } = result;
    expect(licence.licenceId).toBe(minted.payload.licenceId);
    expect(licence.clientId).toBe(FIXTURE_CLIENT.id);
    expect(licence.clientName).toBe(FIXTURE_CLIENT.name);
    expect(licence.deploymentId).toBe(FIXTURE_DEPLOYMENT_ID);
    expect(licence.keyId).toBe(minted.key.kid);
    expect(licence.schemaVersion).toBe(1);
    expect(licence.timeZone).toBe("Africa/Lagos");
    for (const field of [
      licence.issuedAt,
      licence.notBefore,
      licence.expiresAt,
      licence.graceEndsAt,
    ]) {
      expect(field).toBeInstanceOf(Date);
      expect(Number.isFinite(field.getTime())).toBe(true);
    }
    expect(licence.expiresAt.getTime() - FIXTURE_NOW.getTime()).toBe(90 * DAY_MS);
    expect(licence.graceEndsAt.getTime() - licence.expiresAt.getTime()).toBe(14 * DAY_MS);
    expect(licence.support.renewalEmail).toBe("renewals@provider.example");
    expect(licence.raw).toBe(minted.raw);
  });

  it("trims the raw text it returns", () => {
    const minted = mintLicence();
    const result = verifyLicence(`${minted.raw}\n`, ctxFor(minted));
    expect(result.ok && result.licence.raw).toBe(minted.raw);
  });

  it("returns BAD_SIGNATURE when one character inside the payload part is altered", () => {
    const minted = mintLicence();
    const parts = minted.raw.split(".");
    const payload = parts[2];
    const index = Math.floor(payload.length / 2);
    const replacement = payload[index] === "A" ? "B" : "A";
    parts[2] = `${payload.slice(0, index)}${replacement}${payload.slice(index + 1)}`;

    expect(verifyLicence(parts.join("."), ctxFor(minted))).toEqual({
      ok: false,
      code: "BAD_SIGNATURE",
    });
  });

  it("returns BAD_SIGNATURE when the licence was signed by a different key under the same kid", () => {
    const minted = mintLicence({ signing: "wrong-key" });
    expect(verifyLicence(minted.raw, ctxFor(minted))).toEqual({
      ok: false,
      code: "BAD_SIGNATURE",
    });
  });

  it("returns BAD_FORMAT when the signature part is empty", () => {
    const minted = mintLicence({ signing: "unsigned" });
    expect(verifyLicence(minted.raw, ctxFor(minted))).toEqual({ ok: false, code: "BAD_FORMAT" });
  });

  it("returns WRONG_DEPLOYMENT when the context deployment differs from the payload", () => {
    const minted = mintLicence();
    expect(
      verifyLicence(minted.raw, ctxFor(minted, { deploymentId: "some-other-deployment" })),
    ).toEqual({ ok: false, code: "WRONG_DEPLOYMENT" });
  });

  it("returns WRONG_CLIENT when the pinned client differs, and never when no client is pinned", () => {
    const minted = mintLicence();
    expect(
      verifyLicence(minted.raw, ctxFor(minted, { registeredClientId: "another-client" })),
    ).toEqual({ ok: false, code: "WRONG_CLIENT" });
    expect(verifyLicence(minted.raw, ctxFor(minted, { registeredClientId: null })).ok).toBe(true);
    expect(
      verifyLicence(minted.raw, ctxFor(minted, { registeredClientId: FIXTURE_CLIENT.id })).ok,
    ).toBe(true);
  });

  it("returns BAD_FORMAT for any header alg other than Ed25519 even when correctly signed", () => {
    const minted = mintLicence({ header: { alg: "HS256" } });
    expect(verifyLicence(minted.raw, ctxFor(minted))).toEqual({ ok: false, code: "BAD_FORMAT" });

    const none = mintLicence({ header: { alg: "none" } });
    expect(verifyLicence(none.raw, ctxFor(none))).toEqual({ ok: false, code: "BAD_FORMAT" });
  });

  it("returns UNKNOWN_KEY when the kid is absent from the trust set", () => {
    const minted = mintLicence();
    const other = createFixtureKey("some-other-key");
    expect(
      verifyLicence(minted.raw, ctxFor(minted, { trustSet: fixtureTrustSet([other]) })),
    ).toEqual({ ok: false, code: "UNKNOWN_KEY" });
  });

  it("returns KEY_REVOKED for a revoked key and still verifies a retired key", () => {
    const key = createFixtureKey("rotating-key");
    const minted = mintLicence({ key });
    expect(
      verifyLicence(
        minted.raw,
        ctxFor(minted, { trustSet: fixtureTrustSet([{ ...key, status: "revoked" }]) }),
      ),
    ).toEqual({ ok: false, code: "KEY_REVOKED" });
    expect(
      verifyLicence(
        minted.raw,
        ctxFor(minted, { trustSet: fixtureTrustSet([{ ...key, status: "retired" }]) }),
      ).ok,
    ).toBe(true);
  });

  it("returns UNSUPPORTED_SCHEMA for an unrecognised payload schemaVersion that is correctly signed", () => {
    const minted = mintLicence({ payload: { schemaVersion: 2 } });
    expect(verifyLicence(minted.raw, ctxFor(minted))).toEqual({
      ok: false,
      code: "UNSUPPORTED_SCHEMA",
    });
  });

  describe("notBefore (activate mode only)", () => {
    function mintedWithNotBefore(): ReturnType<typeof mintLicence> {
      const notBefore = new Date(FIXTURE_NOW.getTime() + SKEW_TOLERANCE_MS);
      return mintLicence({
        payload: {
          issuedAt: new Date(FIXTURE_NOW.getTime() - DAY_MS).toISOString(),
          notBefore: notBefore.toISOString(),
        },
      });
    }

    it("accepts now exactly 10 minutes before notBefore", () => {
      const minted = mintedWithNotBefore();
      expect(verifyLicence(minted.raw, ctxFor(minted, { now: FIXTURE_NOW })).ok).toBe(true);
    });

    it("returns NOT_YET_VALID one millisecond beyond the skew tolerance", () => {
      const minted = mintedWithNotBefore();
      const earlier = new Date(FIXTURE_NOW.getTime() - 1);
      expect(verifyLicence(minted.raw, ctxFor(minted, { now: earlier }))).toEqual({
        ok: false,
        code: "NOT_YET_VALID",
      });
    });

    it("does not evaluate notBefore in runtime mode, however far behind the clock is", () => {
      const minted = mintedWithNotBefore();
      const longBefore = new Date(FIXTURE_NOW.getTime() - 400 * DAY_MS);
      expect(
        verifyLicence(minted.raw, ctxFor(minted, { now: longBefore, mode: "runtime" })).ok,
      ).toBe(true);
    });
  });

  it("verifies a licence whose expiry and grace are already past, in both modes (D-10, D-11)", () => {
    const minted = mintLicence({
      payload: {
        issuedAt: "2025-01-01T00:00:00.000Z",
        notBefore: "2025-01-01T00:00:00.000Z",
        expiresAt: "2026-06-01T00:00:00.000Z",
        graceEndsAt: "2026-06-15T00:00:00.000Z",
      },
    });
    expect(FIXTURE_NOW.getTime()).toBeGreaterThan(Date.parse("2026-06-15T00:00:00.000Z"));
    expect(verifyLicence(minted.raw, ctxFor(minted, { mode: "activate" })).ok).toBe(true);
    expect(verifyLicence(minted.raw, ctxFor(minted, { mode: "runtime" })).ok).toBe(true);
  });
});

describe("trust set loading", () => {
  it("has an empty production key list and three development keys in the specified statuses", () => {
    expect(PRODUCTION_TRUSTED_KEYS).toHaveLength(0);
    expect(DEV_TRUSTED_KEYS.map((key) => [key.kid, key.status])).toEqual([
      ["dev-golden-a", "active"],
      ["dev-golden-b", "retired"],
      ["dev-golden-c", "revoked"],
    ]);
  });

  it("returns only the production keys in production and adds the development keys otherwise", () => {
    expect(loadTrustSet({ nodeEnv: "production" }).size).toBe(PRODUCTION_TRUSTED_KEYS.length);
    expect(loadTrustSet({ nodeEnv: "production" }).has("dev-golden-a")).toBe(false);

    for (const nodeEnv of ["test", "development", undefined]) {
      const set = loadTrustSet({ nodeEnv });
      expect([...set.keys()].sort()).toEqual(DEV_TRUSTED_KEYS.map((key) => key.kid).sort());
    }
  });

  it("throws LicenceUnavailableError on a duplicate kid", () => {
    const key = createFixtureKey("duplicate");
    expect(() =>
      buildTrustSet([
        { kid: key.kid, x: key.x, status: "active" },
        { kid: key.kid, x: key.x, status: "retired" },
      ]),
    ).toThrow(LicenceUnavailableError);
  });

  it("throws LicenceUnavailableError (not a rejection code) when a shipped key is malformed", () => {
    const minted = mintLicence();
    const broken = buildTrustSet([{ kid: minted.key.kid, x: "not-a-real-key", status: "active" }]);
    expect(() => verifyLicence(minted.raw, ctxFor(minted, { trustSet: broken }))).toThrow(
      LicenceUnavailableError,
    );
  });
});

describe("golden vectors (schema-1)", () => {
  const vectorDir = path.resolve(process.cwd(), "tests/fixtures/licence/schema-1");
  const manifest = JSON.parse(readFileSync(path.join(vectorDir, "manifest.json"), "utf8")) as Array<{
    file: string;
    expect: string;
    mode: "activate" | "runtime";
  }>;

  const EXPECTED_FILES = [
    "valid-active.lic",
    "valid-grace.lic",
    "expired.lic",
    "retired-key.lic",
    "revoked-key.lic",
    "unknown-key.lic",
    "wrong-deployment.lic",
    "tampered-payload.lic",
    "unsupported-prefix.lic",
    "unsupported-schema.lic",
  ];

  it("lists exactly the ten vectors and every file exists", () => {
    expect(manifest.map((entry) => entry.file).sort()).toEqual([...EXPECTED_FILES].sort());
    const onDisk = readdirSync(vectorDir).filter((name) => name.endsWith(".lic"));
    expect(onDisk.sort()).toEqual([...EXPECTED_FILES].sort());
  });

  it.each(manifest.map((entry) => [entry.file, entry] as const))(
    "%s yields its recorded outcome under FIXTURE_NOW",
    (_file, entry) => {
      const raw = readFileSync(path.join(vectorDir, entry.file), "utf8");
      const result = verifyLicence(raw, {
        trustSet: loadTrustSet({ nodeEnv: "test" }),
        deploymentId: "golden-deployment-0001",
        registeredClientId: null,
        now: FIXTURE_NOW,
        mode: entry.mode,
      });
      if (entry.expect === "ok") {
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.licence.clientId).toBe("golden-client-0001");
      } else {
        expect(result).toEqual({ ok: false, code: entry.expect });
      }
    },
  );

  it("rejects the golden active licence under a production trust set (dev keys not trusted)", () => {
    const raw = readFileSync(path.join(vectorDir, "valid-active.lic"), "utf8");
    expect(
      verifyLicence(raw, {
        trustSet: loadTrustSet({ nodeEnv: "production" }),
        deploymentId: "golden-deployment-0001",
        registeredClientId: null,
        now: FIXTURE_NOW,
        mode: "activate",
      }),
    ).toEqual({ ok: false, code: "UNKNOWN_KEY" });
  });
});

describe("private key hygiene (D-03, T-14-02-04)", () => {
  function filesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
  }

  it("no file under tests/fixtures/licence or tests/support contains a private key marker", () => {
    const files = [
      ...filesUnder(path.resolve(process.cwd(), "tests/fixtures/licence")),
      ...filesUnder(path.resolve(process.cwd(), "tests/support")),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(readFileSync(file, "utf8").includes("PRIVATE KEY"), file).toBe(false);
    }
  });

  it("the golden-vector generator refuses to run when manifest.json exists, changing nothing", () => {
    const vectorDir = path.resolve(process.cwd(), "tests/fixtures/licence/schema-1");
    const before = readdirSync(vectorDir)
      .sort()
      .map((name) => [name, readFileSync(path.join(vectorDir, name), "utf8")]);

    expect(() =>
      execFileSync(
        process.execPath,
        [
          path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
          path.resolve(process.cwd(), "tests/support/generate-licence-golden-vectors.ts"),
        ],
        { cwd: process.cwd(), stdio: "pipe" },
      ),
    ).toThrow();

    const after = readdirSync(vectorDir)
      .sort()
      .map((name) => [name, readFileSync(path.join(vectorDir, name), "utf8")]);
    expect(after).toEqual(before);
  }, 60_000);
});
