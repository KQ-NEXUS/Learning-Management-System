import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getOwnOrder: vi.fn(),
  initiateStripePayment: vi.fn(),
  initiatePaystackPayment: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: async () => ({ userId: "learner-1" }) }));
vi.mock("@/server/services/checkout-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/checkout-service")>();
  return {
    ...actual,
    getOwnOrder: m.getOwnOrder,
    initiateStripePayment: m.initiateStripePayment,
    initiatePaystackPayment: m.initiatePaystackPayment,
  };
});

import { payAction } from "@/app/(checkout)/checkout/[orderId]/actions";
import { HoldExpiredError } from "@/server/services/checkout-service";

function form() {
  const fd = new FormData();
  fd.set("orderId", "order-1");
  fd.set("acceptedTerms", "true");
  fd.set("acceptedRefundCancellation", "true");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getOwnOrder.mockResolvedValue({ id: "order-1", reference: "ORD-1", selectedProvider: "PAYSTACK" });
});

describe("payAction — a provider failure returns the learner to checkout, not the error page", () => {
  it("a provider API error lands back on the order with payment=unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.initiatePaystackPayment.mockRejectedValue(new Error('"email" must be a valid email'));
    await expect(payAction(form())).rejects.toThrow("NEXT_REDIRECT:/checkout/order-1?payment=unavailable");
  });

  it("the typed hold-expired refusal still returns to the plain order page", async () => {
    m.initiatePaystackPayment.mockRejectedValue(new HoldExpiredError("order-1"));
    await expect(payAction(form())).rejects.toThrow("NEXT_REDIRECT:/checkout/order-1");
    expect(m.redirect).toHaveBeenCalledWith("/checkout/order-1");
  });

  it("a successful start still goes to the provider", async () => {
    m.initiatePaystackPayment.mockResolvedValue({ url: "https://checkout.paystack.com/x" });
    await expect(payAction(form())).rejects.toThrow("NEXT_REDIRECT:https://checkout.paystack.com/x");
  });
});
