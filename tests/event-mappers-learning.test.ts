/**
 * Pure unit coverage for the result-release and certificate-lifecycle mapper
 * group (D-07, D-17, T-11-50, T-13-03) against a fake transaction client — no
 * database needed for the pure branching logic; the real Postgres proof of
 * the drain actually persisting these intents (and the RESULT_NOTICES mute
 * effect / always-sent certificate behaviour) lives in
 * `tests/learning-drain.integration.test.ts`.
 *
 * Mappers are looked up through `buildMapperTable(EVENT_MAPPER_GROUPS)` —
 * the same path production code and `tests/support/drain-harness.ts` use —
 * rather than importing `learning.ts` directly (see
 * `tests/event-mappers-enrolment-payment.test.ts` for the module-cycle
 * rationale).
 */

import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  buildMapperTable,
  EVENT_MAPPER_GROUPS,
  type DrainEvent,
  type EventMapper,
  type MapperContext,
} from "@/server/services/event-intent-mappers";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const mapperTable = buildMapperTable(EVENT_MAPPER_GROUPS);

function requireOneMapper(type: DrainEvent["type"]): EventMapper {
  const mappers = mapperTable[type];
  expect(mappers).toHaveLength(1);
  return mappers[0]!;
}

type CtxOverrides = {
  enrolment?: (args: unknown) => Promise<unknown>;
  assessment?: (args: unknown) => Promise<unknown>;
  certificate?: (args: unknown) => Promise<unknown>;
};

function makeCtx(overrides: CtxOverrides = {}): MapperContext {
  return {
    tx: {
      enrolment: { findUnique: overrides.enrolment ?? (async () => null) },
      assessment: { findUnique: overrides.assessment ?? (async () => null) },
      certificate: { findUnique: overrides.certificate ?? (async () => null) },
    } as unknown as Prisma.TransactionClient,
    now: () => NOW,
  };
}

function makeEvent(
  type: DrainEvent["type"],
  payload: Record<string, unknown>,
  id = "evt-1",
): DrainEvent {
  return { id, type, payload, occurredAt: NOW };
}

describe("createLearningMappers registration", () => {
  it("registers exactly one mapper for every event type in this group", () => {
    for (const type of [
      "grade.released",
      "grade.overridden",
      "certificate.issued",
      "certificate.revoked",
      "certificate.reissued",
    ] as const) {
      expect(mapperTable[type]).toHaveLength(1);
    }
  });
});

describe("grade.released / grade.overridden (D-07, T-13-03)", () => {
  it("a quiz auto-release payload (score, maxScore, passed present) mails the learner once with the assessment title only, never the score", async () => {
    const mapper = requireOneMapper("grade.released");
    const ctx = makeCtx({
      enrolment: async () => ({ userId: "user-1" }),
      assessment: async () => ({ title: "Module 1 Quiz" }),
    });

    const intents = await mapper(
      makeEvent("grade.released", {
        gradeId: "grade-1",
        assessmentId: "assess-1",
        enrolmentId: "enr-1",
        attemptId: "att-1",
        score: 87.31,
        maxScore: 100,
        passed: true,
        releasedBy: "SYSTEM_AUTO",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-1");
    expect(intents[0]!.email).toEqual({
      template: "grade-released",
      params: { assessmentTitle: "Module 1 Quiz", resultsPath: "/learn/enr-1/results" },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "grade.released",
      targetType: "LEARNER_RESULTS",
      targetId: "enr-1",
      params: { assessmentTitle: "Module 1 Quiz" },
    });
    const serialized = JSON.stringify(intents[0]);
    expect(serialized).not.toContain("87.31");
    expect(serialized).not.toContain("maxScore");
    expect(serialized).not.toContain("passed");
  });

  it("a staff-release payload (releasedBy STAFF) yields the identical output shape", async () => {
    const mapper = requireOneMapper("grade.released");
    const ctx = makeCtx({
      enrolment: async () => ({ userId: "user-2" }),
      assessment: async () => ({ title: "Final Assignment" }),
    });

    const intents = await mapper(
      makeEvent("grade.released", {
        gradeId: "grade-2",
        assessmentId: "assess-2",
        enrolmentId: "enr-2",
        submissionId: "sub-2",
        score: 42,
        maxScore: 50,
        passed: false,
        releasedBy: "STAFF",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.email!.template).toBe("grade-released");
    expect(intents[0]!.email!.params).toEqual({
      assessmentTitle: "Final Assignment",
      resultsPath: "/learn/enr-2/results",
    });
  });

  it("an override payload yields the grade-overridden template and notification type, never previousScore/newScore/passedChanged", async () => {
    const mapper = requireOneMapper("grade.overridden");
    const ctx = makeCtx({
      enrolment: async () => ({ userId: "user-3" }),
      assessment: async () => ({ title: "Module 2 Quiz" }),
    });

    const intents = await mapper(
      makeEvent("grade.overridden", {
        gradeId: "grade-3",
        assessmentId: "assess-3",
        enrolmentId: "enr-3",
        previousScore: 40,
        newScore: 55,
        passedChanged: true,
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.email!.template).toBe("grade-overridden");
    expect(intents[0]!.notification!.type).toBe("grade.overridden");
    const serialized = JSON.stringify(intents[0]);
    expect(serialized).not.toContain("previousScore");
    expect(serialized).not.toContain("newScore");
    expect(serialized).not.toContain("passedChanged");
    expect(serialized).not.toContain("55");
  });

  it("returns no intents when the enrolment no longer exists (edge)", async () => {
    const mapper = requireOneMapper("grade.released");
    const ctx = makeCtx({ enrolment: async () => null });
    const intents = await mapper(
      makeEvent("grade.released", {
        gradeId: "grade-x",
        assessmentId: "assess-x",
        enrolmentId: "gone",
        score: 1,
        maxScore: 1,
        passed: true,
      }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("returns no intents when the assessment no longer exists (edge)", async () => {
    const mapper = requireOneMapper("grade.released");
    const ctx = makeCtx({
      enrolment: async () => ({ userId: "user-4" }),
      assessment: async () => null,
    });
    const intents = await mapper(
      makeEvent("grade.released", {
        gradeId: "grade-y",
        assessmentId: "gone",
        enrolmentId: "enr-4",
        score: 1,
        maxScore: 1,
        passed: true,
      }),
      ctx,
    );
    expect(intents).toEqual([]);
  });

  it("hostile extra payload keys are never copied into templateParams or notification params", async () => {
    const mapper = requireOneMapper("grade.released");
    const ctx = makeCtx({
      enrolment: async () => ({ userId: "user-5" }),
      assessment: async () => ({ title: "Module 3 Quiz" }),
    });
    const intents = await mapper(
      makeEvent("grade.released", {
        gradeId: "grade-z",
        assessmentId: "assess-z",
        enrolmentId: "enr-5",
        score: 99,
        maxScore: 100,
        passed: true,
        secretInternalNote: "SECRET-EXTRA-FIELD",
      }),
      ctx,
    );
    expect(JSON.stringify(intents)).not.toContain("SECRET-EXTRA-FIELD");
  });

  it("two different learners' grade.released events each receive only their own intent (multi-recipient isolation, edge)", async () => {
    const mapper = requireOneMapper("grade.released");
    const ctxA = makeCtx({
      enrolment: async () => ({ userId: "learner-a" }),
      assessment: async () => ({ title: "Shared Assessment" }),
    });
    const ctxB = makeCtx({
      enrolment: async () => ({ userId: "learner-b" }),
      assessment: async () => ({ title: "Shared Assessment" }),
    });

    const intentsA = await mapper(
      makeEvent(
        "grade.released",
        { gradeId: "grade-a", assessmentId: "assess-shared", enrolmentId: "enr-a", score: 10, maxScore: 10, passed: true },
        "evt-a",
      ),
      ctxA,
    );
    const intentsB = await mapper(
      makeEvent(
        "grade.released",
        { gradeId: "grade-b", assessmentId: "assess-shared", enrolmentId: "enr-b", score: 20, maxScore: 20, passed: true },
        "evt-b",
      ),
      ctxB,
    );

    expect(intentsA).toHaveLength(1);
    expect(intentsB).toHaveLength(1);
    expect(intentsA[0]!.recipientUserId).toBe("learner-a");
    expect(intentsB[0]!.recipientUserId).toBe("learner-b");
    expect(intentsA[0]!.recipientUserId).not.toBe(intentsB[0]!.recipientUserId);
  });
});

describe("certificate.issued (D-07, A-18, T-13-42)", () => {
  it("mails the certificate's own user (never a payload user id) with the verification reference and dashboard link", async () => {
    const mapper = requireOneMapper("certificate.issued");
    const ctx = makeCtx({
      certificate: async () => ({ userId: "user-cert-1", verificationRef: "CERT-2026-0001" }),
    });

    const intents = await mapper(
      makeEvent("certificate.issued", {
        certificateId: "cert-1",
        enrolmentId: "enr-1",
        scope: "COURSE",
        verificationRef: "CERT-2026-0001",
        userId: "FORGED-USER-ID",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-cert-1");
    expect(intents[0]!.recipientUserId).not.toBe("FORGED-USER-ID");
    expect(intents[0]!.email).toEqual({
      template: "certificate-issued",
      params: { verificationRef: "CERT-2026-0001", dashboardPath: "/dashboard" },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification).toEqual({
      type: "certificate.issued",
      targetType: "LEARNER_DASHBOARD",
      targetId: "cert-1",
      params: { verificationRef: "CERT-2026-0001" },
    });
  });

  it("returns no intents when the certificate row does not exist (edge)", async () => {
    const mapper = requireOneMapper("certificate.issued");
    const ctx = makeCtx({ certificate: async () => null });
    const intents = await mapper(
      makeEvent("certificate.issued", { certificateId: "gone", enrolmentId: "enr-1", scope: "COURSE", verificationRef: "n/a" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});

describe("certificate.revoked (D-07, T-11-50, T-13-03)", () => {
  it("mails only the verification reference, never a hostile reason key present on the payload", async () => {
    const mapper = requireOneMapper("certificate.revoked");
    const ctx = makeCtx({
      certificate: async () => ({ userId: "user-cert-2", verificationRef: "CERT-2026-0002" }),
    });

    const intents = await mapper(
      makeEvent("certificate.revoked", {
        certificateId: "cert-2",
        enrolmentId: "enr-2",
        verificationRef: "CERT-2026-0002",
        reason: "SECRET-REVOCATION-REASON",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.email).toEqual({
      template: "certificate-revoked",
      params: { verificationRef: "CERT-2026-0002" },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification!.type).toBe("certificate.revoked");
    expect(JSON.stringify(intents)).not.toContain("SECRET-REVOCATION-REASON");
  });

  it("returns no intents when the certificate row does not exist (edge)", async () => {
    const mapper = requireOneMapper("certificate.revoked");
    const ctx = makeCtx({ certificate: async () => null });
    const intents = await mapper(
      makeEvent("certificate.revoked", { certificateId: "gone", enrolmentId: "enr-2", verificationRef: "n/a" }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});

describe("certificate.reissued (D-07, T-11-50, T-13-03)", () => {
  it("resolves the holder from the NEW certificate row and mails both references, never a hostile reason key", async () => {
    const mapper = requireOneMapper("certificate.reissued");
    const ctx = makeCtx({
      certificate: async () => ({ userId: "user-cert-3", verificationRef: "CERT-2026-0004" }),
    });

    const intents = await mapper(
      makeEvent("certificate.reissued", {
        oldCertificateId: "cert-3-old",
        newCertificateId: "cert-3-new",
        oldVerificationRef: "CERT-2026-0003",
        newVerificationRef: "CERT-2026-0004",
        reason: "SECRET-REISSUE-REASON",
      }),
      ctx,
    );

    expect(intents).toHaveLength(1);
    expect(intents[0]!.recipientUserId).toBe("user-cert-3");
    expect(intents[0]!.email).toEqual({
      template: "certificate-reissued",
      params: {
        oldVerificationRef: "CERT-2026-0003",
        newVerificationRef: "CERT-2026-0004",
        dashboardPath: "/dashboard",
      },
      correlationId: "evt-1",
    });
    expect(intents[0]!.notification!.type).toBe("certificate.reissued");
    expect(intents[0]!.notification!.targetId).toBe("cert-3-new");
    expect(JSON.stringify(intents)).not.toContain("SECRET-REISSUE-REASON");
  });

  it("returns no intents when the new certificate row does not exist (edge)", async () => {
    const mapper = requireOneMapper("certificate.reissued");
    const ctx = makeCtx({ certificate: async () => null });
    const intents = await mapper(
      makeEvent("certificate.reissued", {
        oldCertificateId: "cert-old",
        newCertificateId: "gone",
        oldVerificationRef: "CERT-OLD",
        newVerificationRef: "CERT-NEW",
      }),
      ctx,
    );
    expect(intents).toEqual([]);
  });
});
