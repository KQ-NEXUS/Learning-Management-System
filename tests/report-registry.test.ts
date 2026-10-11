import { describe, expect, it } from "vitest";
import {
  EXPORT_DATASET_REGISTRY,
  REPORT_REGISTRY,
  getExportDatasetDefinition,
  getReportDefinition,
  isExportDataset,
  isReportDataset,
} from "@/server/services/report-registry";

const REPORT_IDS = [
  "registrations",
  "payments",
  "enrolments",
  "attendance",
  "progress",
  "submissions",
  "grades",
  "completion",
  "certificates",
  "support",
] as const;

describe("report registry", () => {
  it("defines exactly ten dashboards in the fixed D-11 group order", () => {
    expect(REPORT_REGISTRY.map((definition) => definition.id)).toEqual(REPORT_IDS);
    expect(REPORT_REGISTRY.map((definition) => definition.group)).toEqual([
      "ADMISSIONS_FINANCE",
      "ADMISSIONS_FINANCE",
      "ADMISSIONS_FINANCE",
      "LEARNING_DELIVERY",
      "LEARNING_DELIVERY",
      "LEARNING_DELIVERY",
      "LEARNING_DELIVERY",
      "OUTCOMES_SUPPORT",
      "OUTCOMES_SUPPORT",
      "OUTCOMES_SUPPORT",
    ]);
  });

  it("marks only operational datasets available, independent of table existence", () => {
    expect(
      REPORT_REGISTRY.filter((definition) => definition.availability === "AVAILABLE").map(
        (definition) => definition.id,
      ),
    ).toEqual(["registrations", "payments", "enrolments", "attendance", "support"]);
    expect(
      REPORT_REGISTRY.filter(
        (definition) => definition.availability === "NOT_AVAILABLE_YET",
      ).map((definition) => definition.id),
    ).toEqual(["progress", "submissions", "grades", "completion", "certificates"]);
  });

  it("owns the prescribed business-event date labels", () => {
    expect(Object.fromEntries(REPORT_REGISTRY.map((definition) => [definition.id, definition.businessDateLabel]))).toEqual({
      registrations: "Registration date",
      payments: "Payment confirmation date",
      enrolments: "Enrolment activation/transition date",
      attendance: "Session date",
      progress: "Progress event date",
      submissions: "Submission date",
      grades: "Grade release date",
      completion: "Completion date",
      certificates: "Certificate issue date",
      support: "Ticket creation date",
    });
  });

  it("defines thirteen metadata-only export datasets without dashboard or producer fields", () => {
    expect(EXPORT_DATASET_REGISTRY.map((definition) => definition.id)).toEqual([
      ...REPORT_IDS,
      "reconciliation-refunds",
      "audit",
      "learner-subject",
    ]);

    for (const definition of EXPORT_DATASET_REGISTRY) {
      expect(Object.keys(definition).filter((key) => key !== "dataPermission" && key !== "standalone").sort()).toEqual([
        "filterSchema",
        "id",
        "permission",
        "safeColumns",
        "scopePolicy",
        "sensitiveColumns",
        "version",
      ]);
      expect(definition).not.toHaveProperty("rows");
      expect(definition).not.toHaveProperty("producer");
      expect(definition).not.toHaveProperty("query");
      expect(definition).not.toHaveProperty("browserScope");
      expect(definition).not.toHaveProperty("availability");
      expect(definition).not.toHaveProperty("group");
      expect(definition.sensitiveColumns.every((column) => column.permission === "users.view")).toBe(true);
    }
  });

  it("guards the payments dataset with payments.view as well, in both registries, and no other dataset (A-02)", () => {
    const guarded = (registry: readonly { id: string; dataPermission?: string }[]) =>
      registry.filter((definition) => definition.dataPermission).map((definition) => [definition.id, definition.dataPermission]);
    expect(guarded(REPORT_REGISTRY)).toEqual([["payments", "payments.view"]]);
    expect(guarded(EXPORT_DATASET_REGISTRY)).toEqual([["payments", "payments.view"]]);
  });

  it("gates the learner-subject export by privacy.manage alone, at Global scope, with a sensitive value column (D-12)", () => {
    const definition = getExportDatasetDefinition("learner-subject");
    expect(definition.permission).toBe("privacy.manage");
    expect(definition.scopePolicy).toBe("GLOBAL");
    expect(definition.standalone).toBe(true);
    expect(definition.sensitiveColumns.map((column) => column.key)).toEqual(["value"]);
    expect(definition.safeColumns.map((column) => column.key)).toEqual(["section", "recordType", "recordId", "field", "recordedAt"]);
    // Only learner-subject is standalone; every other dataset still needs reports.export (or audit.export).
    expect(EXPORT_DATASET_REGISTRY.filter((item) => item.standalone).map((item) => item.id)).toEqual(["learner-subject"]);
    // One learner at a time: the only filter is a single user id, strictly.
    expect(definition.filterSchema.safeParse({ userId: "abc" }).success).toBe(true);
    expect(definition.filterSchema.safeParse({}).success).toBe(false);
    expect(definition.filterSchema.safeParse({ userId: "abc", from: "2026-01-01" }).success).toBe(false);
    expect(definition.filterSchema.safeParse({ userId: ["a", "b"] }).success).toBe(false);
  });

  it("is immutable and rejects unknown report and export identifiers at runtime", () => {
    expect(Object.isFrozen(REPORT_REGISTRY)).toBe(true);
    expect(Object.isFrozen(EXPORT_DATASET_REGISTRY)).toBe(true);
    expect(isReportDataset("payments")).toBe(true);
    expect(isReportDataset("audit")).toBe(false);
    expect(isExportDataset("audit")).toBe(true);
    expect(isExportDataset("anything-else")).toBe(false);
    expect(() => getReportDefinition("anything-else")).toThrow(/Unknown report dataset/);
    expect(() => getExportDatasetDefinition("anything-else")).toThrow(/Unknown export dataset/);
  });
});
