import { describe, expect, it } from "vitest";
import { MAX_LICENCE_FILE_CHARS } from "@/server/licence/constants";
import {
  base64UrlDecode,
  base64UrlEncode,
  buildSignedInput,
  ENVELOPE_PREFIX,
  encodeLicenceEnvelope,
  licenceHeaderSchema,
  licencePayloadSchema,
  parseEnvelope,
} from "@/server/licence/format";
import { verifyLicence } from "@/server/licence/verify";
import {
  defaultFixturePayload,
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  mintLicence,
} from "./support/licence-fixtures";

/** Verify a properly signed licence carrying the given payload overrides. */
function verifySigned(payload: Record<string, unknown>) {
  const minted = mintLicence({ payload });
  return verifyLicence(minted.raw, {
    trustSet: minted.trustSet,
    deploymentId: FIXTURE_DEPLOYMENT_ID,
    registeredClientId: null,
    now: FIXTURE_NOW,
    mode: "activate",
  });
}

describe("base64url helpers", () => {
  it("encodes without padding and round-trips bytes and strings", () => {
    expect(base64UrlEncode("a")).toBe("YQ");
    expect(base64UrlEncode(Buffer.from([0xfb, 0xff, 0xfe]))).toBe("-__-");
    expect(base64UrlDecode("YQ").toString("utf8")).toBe("a");
    expect([...base64UrlDecode("-__-")]).toEqual([0xfb, 0xff, 0xfe]);
  });

  it("throws on any character outside the base64url alphabet or an impossible length", () => {
    for (const bad of ["YQ==", "Y Q", "Y+Q", "Y/Q", "Y.Q", "YéQ", "A"]) {
      expect(() => base64UrlDecode(bad), bad).toThrow();
    }
  });
});

describe("parseEnvelope", () => {
  it("round-trips encodeLicenceEnvelope and signs the exact prefix.header.payload string", () => {
    const header = { alg: "Ed25519", kid: "k1", typ: "lms-licence", v: 1 };
    const payload = { hello: "world" };
    const signatureBytes = Buffer.from("not-a-real-signature");
    const raw = encodeLicenceEnvelope({ header, payload, signature: signatureBytes });

    const parsed = parseEnvelope(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    expect(parsed.headerB64).toBe(headerB64);
    expect(parsed.payloadB64).toBe(payloadB64);
    expect(parsed.signatureB64).toBe(base64UrlEncode(signatureBytes));
    expect(parsed.signedInput).toBe(`${ENVELOPE_PREFIX}.${headerB64}.${payloadB64}`);
    expect(parsed.signedInput).toBe(buildSignedInput(headerB64, payloadB64));
    expect(ENVELOPE_PREFIX).toBe("LMS-LIC1");
  });

  it("passes the signed input to a signature function", () => {
    let seen = "";
    const raw = encodeLicenceEnvelope({
      header: { a: 1 },
      payload: { b: 2 },
      signature: (signedInput) => {
        seen = signedInput;
        return Buffer.from("sig");
      },
    });
    expect(raw.startsWith(`${seen}.`)).toBe(true);
  });

  describe("size and alphabet boundaries", () => {
    // 8 (prefix) + 1 + 1 (header) + 1 + n (payload) + 1 + 1 (signature) = 13 + n
    const ofLength = (total: number) => `${ENVELOPE_PREFIX}.a.${"b".repeat(total - 13)}.c`;

    it("accepts exactly 8192 allowed characters", () => {
      const raw = ofLength(MAX_LICENCE_FILE_CHARS);
      expect(raw).toHaveLength(8192);
      expect(parseEnvelope(raw).ok).toBe(true);
    });

    it("returns BAD_FORMAT for 8193 characters", () => {
      const raw = ofLength(MAX_LICENCE_FILE_CHARS + 1);
      expect(raw).toHaveLength(8193);
      expect(parseEnvelope(raw)).toEqual({ ok: false, code: "BAD_FORMAT" });
    });

    it("measures the size after trimming a trailing newline", () => {
      expect(parseEnvelope(`${ofLength(MAX_LICENCE_FILE_CHARS)}\n`).ok).toBe(true);
      expect(parseEnvelope(`  ${ofLength(MAX_LICENCE_FILE_CHARS)}\r\n`).ok).toBe(true);
    });

    it("accepts a trailing newline", () => {
      expect(parseEnvelope(`${ENVELOPE_PREFIX}.a.b.c\n`).ok).toBe(true);
    });

    it.each([
      ["an interior space", `${ENVELOPE_PREFIX}.a b.c.d`],
      ["an interior newline", `${ENVELOPE_PREFIX}.a.b\n.c.d`],
      ["a non-ASCII character", `${ENVELOPE_PREFIX}.a.bé.c`],
      ["an empty string", ""],
      ["whitespace only", "   \n"],
      ["three parts", `${ENVELOPE_PREFIX}.a.b`],
      ["five parts", `${ENVELOPE_PREFIX}.a.b.c.d`],
      ["an empty header part", `${ENVELOPE_PREFIX}..b.c`],
      ["an empty signature part", `${ENVELOPE_PREFIX}.a.b.`],
      ["a base64 padding character", `${ENVELOPE_PREFIX}.a.b.c==`],
    ])("returns BAD_FORMAT for %s", (_label, raw) => {
      expect(parseEnvelope(raw)).toEqual({ ok: false, code: "BAD_FORMAT" });
    });
  });

  describe("prefix handling", () => {
    it("reports an unrecognised LMS-LIC{n} prefix as UNSUPPORTED_SCHEMA", () => {
      expect(parseEnvelope("LMS-LIC2.a.b.c")).toEqual({ ok: false, code: "UNSUPPORTED_SCHEMA" });
      expect(parseEnvelope("LMS-LIC10.a.b.c")).toEqual({ ok: false, code: "UNSUPPORTED_SCHEMA" });
    });

    it.each(["LMS-LICX", "lms-lic1", "LMS-LIC", "LMS_LIC1", "XXX"])(
      "reports prefix %s as BAD_FORMAT",
      (prefix) => {
        expect(parseEnvelope(`${prefix}.a.b.c`)).toEqual({ ok: false, code: "BAD_FORMAT" });
      },
    );
  });
});

describe("header schema", () => {
  it("accepts the published header and rejects other algorithms, types and versions", () => {
    const good = { alg: "Ed25519", kid: "dev-1", typ: "lms-licence", v: 1 };
    expect(licenceHeaderSchema.safeParse(good).success).toBe(true);
    for (const bad of [
      { ...good, alg: "HS256" },
      { ...good, alg: "ed25519" },
      { ...good, typ: "jwt" },
      { ...good, v: 2 },
      { ...good, kid: "" },
      { ...good, kid: "k".repeat(65) },
      { ...good, kid: "has space" },
    ]) {
      expect(licenceHeaderSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(licenceHeaderSchema.safeParse({ ...good, kid: "k".repeat(64) }).success).toBe(true);
  });
});

describe("tolerant reader and payload rules (signature valid, so the schema is what fails)", () => {
  it("ignores an unknown optional payload member and strips it from the parsed result", () => {
    const withExtra = { ...defaultFixturePayload(), futureNote: "ignore me" };
    const parsed = licencePayloadSchema.safeParse(withExtra);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("futureNote" in parsed.data).toBe(false);

    expect(verifySigned({ futureNote: "ignore me", support: { ...(defaultFixturePayload().support as object), extra: 1 } }).ok).toBe(true);
  });

  it("returns BAD_FORMAT when a required member is missing", () => {
    expect(verifySigned({ client: { name: "No id" } })).toEqual({ ok: false, code: "BAD_FORMAT" });
    expect(verifySigned({ deploymentId: undefined })).toEqual({ ok: false, code: "BAD_FORMAT" });
    expect(verifySigned({ support: { supportEmail: "support@provider.example" } })).toEqual({
      ok: false,
      code: "BAD_FORMAT",
    });
  });

  it("returns BAD_FORMAT when the date order is violated", () => {
    expect(
      verifySigned({
        notBefore: "2027-01-02T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        graceEndsAt: "2027-02-01T00:00:00.000Z",
        issuedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual({ ok: false, code: "BAD_FORMAT" });
    expect(
      verifySigned({
        notBefore: "2026-09-30T00:00:00.000Z",
        expiresAt: "2027-01-02T00:00:00.000Z",
        graceEndsAt: "2027-01-01T00:00:00.000Z",
        issuedAt: "2026-09-30T00:00:00.000Z",
      }),
    ).toEqual({ ok: false, code: "BAD_FORMAT" });
    expect(
      verifySigned({
        issuedAt: "2027-01-02T00:00:00.000Z",
        notBefore: "2026-09-30T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
        graceEndsAt: "2027-02-01T00:00:00.000Z",
      }),
    ).toEqual({ ok: false, code: "BAD_FORMAT" });
  });

  it("accepts expiresAt equal to graceEndsAt (grace of zero)", () => {
    expect(
      verifySigned({
        expiresAt: "2027-01-01T00:00:00.000Z",
        graceEndsAt: "2027-01-01T00:00:00.000Z",
      }).ok,
    ).toBe(true);
  });

  it("returns BAD_FORMAT for malformed instants, time zones and emails", () => {
    for (const override of [
      { expiresAt: "2027-01-01" },
      { expiresAt: "2027-01-01T00:00:00+01:00" },
      { expiresAt: "2027-02-31T00:00:00.000Z" },
      { timeZone: "Mars/Olympus" },
      { support: { renewalEmail: "not-an-email", supportEmail: "support@provider.example" } },
      { licenceId: "has space" },
      { licenceId: "x".repeat(65) },
      { schemaVersion: 1.5 },
    ]) {
      expect(verifySigned(override), JSON.stringify(override)).toEqual({
        ok: false,
        code: "BAD_FORMAT",
      });
    }
  });

  it("accepts a payload with no optional support members", () => {
    const result = verifySigned({
      support: { renewalEmail: "renewals@provider.example", supportEmail: "support@provider.example" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.licence.support).toEqual({
        renewalEmail: "renewals@provider.example",
        supportEmail: "support@provider.example",
      });
    }
  });
});
