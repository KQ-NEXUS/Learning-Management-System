import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LicenceBanner } from "@/components/licence/LicenceBanner";
import {
  LicenceRestrictionProvider,
  UNRESTRICTED_LICENCE_RESTRICTION,
  useLicenceRestriction,
} from "@/components/licence/LicenceRestrictionProvider";
import { RESTRICTED_CONTINUITY_LABEL } from "@/server/licence/policy";

afterEach(cleanup);

const RESTRICTED_MESSAGE =
  "Restricted continuity mode is active. New enrolments, checkout, publishing and settings changes are blocked. Your data is kept.";

describe("LicenceBanner (14-19 Task 1, D-15)", () => {
  it("renders the UI-SPEC structure for the danger tone: status role, stable id, tone element, message and link", () => {
    render(
      <LicenceBanner
        tone="danger"
        stateLabel={RESTRICTED_CONTINUITY_LABEL}
        message={RESTRICTED_MESSAGE}
        linkLabel="Activate a licence"
        href="/staff/licence"
      />,
    );

    const strip = screen.getByRole("status");
    expect(strip.id).toBe("licence-restriction-notice");

    const tone = strip.querySelector("[data-tone]") as HTMLElement;
    expect(tone.getAttribute("data-tone")).toBe("danger");
    expect(tone.textContent).toContain("Restricted continuity mode");
    expect(tone.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(tone.className).toContain("border-l-4");
    expect(tone.className).toContain("border-current");

    const message = screen.getByText(RESTRICTED_MESSAGE);
    expect(message.className).toContain("text-white");

    const link = screen.getByRole("link", { name: "Activate a licence" });
    expect(link.getAttribute("href")).toBe("/staff/licence");
    expect(link.className).toContain("underline");
    expect(link.className).toContain("text-white");
    expect(link.className).toContain("min-h-11");
  });

  it("carries data-tone warning for the warning tone", () => {
    render(
      <LicenceBanner
        tone="warning"
        stateLabel="Check pending"
        message="The licence check could not complete. The last known state is kept for up to 24 hours."
        linkLabel="View licence"
        href="/staff/licence"
      />,
    );
    expect(screen.getByRole("status").querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("warning");
  });

  it("is not dismissible and does not animate", () => {
    const { container } = render(
      <LicenceBanner
        tone="warning"
        stateLabel="Expiring soon"
        message="Licence expires in 12 days."
        linkLabel="View licence"
        href="/staff/licence"
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.innerHTML).not.toMatch(/animate-|alert-dot/);
    expect(container.innerHTML).not.toMatch(new RegExp(["read", "-", "only"].join(""), "i"));
  });

  it("wraps on narrow viewports with the link dropping to its own line below sm", () => {
    render(
      <LicenceBanner tone="danger" stateLabel="X" message="Y" linkLabel="View licence" href="/staff/licence" />,
    );
    const strip = screen.getByRole("status");
    expect(strip.className).toContain("flex-wrap");
    expect(strip.className).toContain("min-h-12");
    expect(screen.getByRole("link").className).toContain("w-full");
    expect(screen.getByRole("link").className).toContain("sm:w-auto");
  });
});

describe("useLicenceRestriction (14-19 Task 1)", () => {
  function Probe() {
    return <output data-testid="value">{JSON.stringify(useLicenceRestriction())}</output>;
  }

  it("returns the unrestricted default when no provider is mounted", () => {
    render(<Probe />);
    expect(JSON.parse(screen.getByTestId("value").textContent!)).toEqual({
      restricted: false,
      canViewLicence: false,
      stateLabel: null,
    });
    expect(UNRESTRICTED_LICENCE_RESTRICTION).toEqual({ restricted: false, canViewLicence: false, stateLabel: null });
  });

  it("returns the supplied value inside a provider", () => {
    render(
      <LicenceRestrictionProvider value={{ restricted: true, canViewLicence: true, stateLabel: "Restricted continuity mode" }}>
        <Probe />
      </LicenceRestrictionProvider>,
    );
    expect(JSON.parse(screen.getByTestId("value").textContent!)).toEqual({
      restricted: true,
      canViewLicence: true,
      stateLabel: "Restricted continuity mode",
    });
  });
});
