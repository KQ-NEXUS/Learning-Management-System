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
    ).toEqual(["registrations", "payments", "enrolments", "attendance"]);
    expect(
      REPORT_REGISTRY.filter(
        (definition) => definition.availability === "NOT_AVAILABLE_YET",
      ).map((definition) => definition.id),
    ).toEqual(["progress", "submissions", "grades", "completion", "certificates", "support"]);
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

  it("defines twelve metadata-only export datasets without dashboard or producer fields", () => {
    expect(EXPORT_DATASET_REGISTRY.map((definition) => definition.id)).toEqual([
      ...REPORT_IDS,
      "reconciliation-refunds",
      "audit",
    ]);

    for (const definition of EXPORT_DATASET_REGISTRY) {
      expect(Object.keys(definition).sort()).toEqual([
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
