import { describe, expect, it } from "vitest";
import { humanizeCode, humanizeKey, permissionPhrase, providerLabel, shortId } from "@/lib/humanize";

describe("humanize — UX batch C: codes never reach staff as SCREAMING_CASE", () => {
  it("turns enum and event codes into sentence case", () => {
    expect(humanizeCode("PARTIALLY_REFUNDED")).toBe("Partially refunded");
    expect(humanizeCode("PENDING_PAYMENT")).toBe("Pending payment");
    expect(humanizeCode("enrolment.withdrawn")).toBe("Enrolment withdrawn");
    expect(humanizeCode("refund.access_revoke_failed")).toBe("Refund access revoke failed");
    expect(humanizeCode("")).toBe("—");
    expect(humanizeCode(null)).toBe("—");
  });

  it("turns camelCase keys into labels, with ID and URL kept as initialisms", () => {
    expect(humanizeKey("paymentAttemptId")).toBe("Payment attempt ID");
    expect(humanizeKey("providerRef")).toBe("Provider ref");
    expect(humanizeKey("meetingUrl")).toBe("Meeting URL");
    expect(humanizeKey("amountMinor")).toBe("Amount minor");
  });

  it("shortens long ids and leaves short ones alone", () => {
    expect(shortId("cmuk1uaom0007ulisglrjzwhu")).toBe("cmuk1uao…");
    expect(shortId("abc")).toBe("abc");
    expect(shortId(null)).toBe("—");
  });

  it("names providers", () => {
    expect(providerLabel("PAYSTACK")).toBe("Paystack");
    expect(providerLabel("STRIPE")).toBe("Stripe");
    expect(providerLabel("MANUAL")).toBe("Manual");
    expect(providerLabel("SOMETHING_NEW")).toBe("Something new");
  });
});

describe("permissionPhrase — UX batch D", () => {
  it("reads a permission key as words", () => {
    expect(permissionPhrase("payments.view")).toBe("view payments");
    expect(permissionPhrase("roles.manage")).toBe("manage roles");
    expect(permissionPhrase("oddkey")).toBe("oddkey");
  });
});
