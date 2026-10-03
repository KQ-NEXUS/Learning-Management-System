import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LicenceStatusView } from "@/app/staff/licence/LicenceStatusView";
import { DAY_MS } from "@/server/licence/constants";
import { RESTRICTED_CAPABILITIES } from "@/server/licence/effects";
import {
  ACTIVATION_PERMISSION_NOTE,
  DIAGNOSTIC_HELPER,
  EMPTY_STATE_BODY,
  EXPORTS_HELPER,
  LOAD_ERROR_MESSAGE,
  NOTHING_BLOCKED,
  PRESERVED_DATA_STATEMENT,
  RENEWAL_FALLBACK,
} from "@/server/licence/policy";
import type { LicenceStatusSnapshot } from "@/server/licence/types";
import { buildLicenceStatusView } from "@/server/licence/view-model";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = new Date("2026-10-01T12:00:00.000Z");

function snapshot(overrides: Partial<LicenceStatusSnapshot> = {}): LicenceStatusSnapshot {
  return {
    state: "ACTIVE",
    reasonCode: null,
    isRestricted: false,
    everActivated: true,
    licenceId: "LIC-2026-0001",
    keyId: "secret-key-id-0001",
    schemaVersion: 1,
    clientName: "Fixture Training Academy",
    deploymentId: "fixture-deployment-0001",
    issuedAt: new Date("2026-09-30T12:00:00.000Z"),
    notBefore: new Date("2026-09-30T12:00:00.000Z"),
    expiresAt: new Date("2027-03-31T22:59:59.000Z"),
    graceEndsAt: new Date("2027-04-14T22:59:59.000Z"),
    timeZone: "Africa/Lagos",
    support: {
      renewalEmail: "renewals@provider.example",
      supportEmail: "support@provider.example",
      phone: "+234 800 000 0000",
      hours: "Mon to Fri, 09:00 to 17:00 WAT",
    },
    restrictedAt: null,
    daysRemaining: 182,
    daysToGraceEnd: null,
    underOneDay: false,
    lastVerifiedAt: new Date("2026-10-01T11:00:00.000Z"),
    lastVerificationOutcome: "OK",
    attentionSince: null,
    clockAlertAt: null,
    highWaterAt: new Date("2026-10-01T11:59:00.000Z"),
    evaluatedAt: NOW,
    ...overrides,
  };
}

function viewModel(
  overrides: Partial<LicenceStatusSnapshot> = {},
  flags: { canActivate?: boolean; canViewReports?: boolean } = {},
) {
  return buildLicenceStatusView(snapshot(overrides), {
    canActivate: flags.canActivate ?? true,
    canViewReports: flags.canViewReports ?? true,
    now: NOW,
  });
}

const NEVER_ACTIVATED: Partial<LicenceStatusSnapshot> = {
  state: "UNLICENSED",
  everActivated: false,
  licenceId: null,
  clientName: null,
  expiresAt: null,
  graceEndsAt: null,
  support: null,
  timeZone: null,
  lastVerifiedAt: null,
  lastVerificationOutcome: null,
  daysRemaining: null,
};

describe("LicenceStatusView: an active licence (tracer)", () => {
  it("renders the title, pill, figure, fact labels, both lists and the preserved-data statement", () => {
    render(<LicenceStatusView vm={viewModel()} canActivate />);

    expect(screen.getByRole("heading", { level: 1, name: "Licence & System Status" })).toBeTruthy();
    expect(screen.getAllByText("Active").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("182")).toBeTruthy();
    expect(screen.getByText("days remaining")).toBeTruthy();
    expect(screen.getByText("The licence is valid. Everything works normally.")).toBeTruthy();

    for (const label of ["State", "Licence ID", "Registered client", "Deployment ID", "Expires", "Grace ends", "Last verification"]) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
    expect(screen.getByText("LIC-2026-0001")).toBeTruthy();
    expect(screen.getByText("Fixture Training Academy")).toBeTruthy();
    expect(screen.getByText("fixture-deployment-0001")).toBeTruthy();
    expect(screen.getByText("31 Mar 2027, 23:59 WAT")).toBeTruthy();
    expect(screen.getByText("2027-03-31T22:59:59Z")).toBeTruthy();
    expect(screen.getByText("Africa/Lagos")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();

    expect(screen.getByRole("heading", { name: "What works" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What is blocked" })).toBeTruthy();
    expect(screen.getByText(NOTHING_BLOCKED)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What happens after 14 Apr 2027, 23:59 WAT" })).toBeTruthy();
    for (const capability of RESTRICTED_CAPABILITIES.works) expect(screen.getByText(capability.text)).toBeTruthy();
    expect(screen.getByText(PRESERVED_DATA_STATEMENT)).toBeTruthy();
  });

  it("offers no control that creates, extends, edits, replaces or reactivates a licence (LIC-03)", () => {
    render(<LicenceStatusView vm={viewModel()} canActivate={false} />);
    const controls = [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name, name).not.toMatch(/create|extend|edit|replace|reactivate/i);
    }
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(document.querySelector("form, input, textarea")).toBeNull();
  });

  it("renders the activation slot when canActivate is true and the permission note when it is false", () => {
    const slot = <button type="button">Slot control</button>;
    const { unmount } = render(<LicenceStatusView vm={viewModel()} canActivate activationSlot={slot} />);
    expect(screen.getByRole("heading", { name: "Activate a licence" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Slot control" })).toBeTruthy();
    expect(screen.queryByText(ACTIVATION_PERMISSION_NOTE)).toBeNull();
    unmount();

    render(<LicenceStatusView vm={viewModel({}, { canActivate: false })} canActivate={false} activationSlot={slot} />);
    expect(screen.getByText(ACTIVATION_PERMISSION_NOTE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Slot control" })).toBeNull();
  });

  it("draws no empty activation heading for a holder while no slot is supplied", () => {
    render(<LicenceStatusView vm={viewModel()} canActivate />);
    expect(screen.queryByRole("heading", { name: "Activate a licence" })).toBeNull();
  });
});

describe("LicenceStatusView: never activated (OQ1 option-a)", () => {
  it("shows the empty-state heading and body, the Not activated pill, Not available rows and no figure", () => {
    const { container } = render(<LicenceStatusView vm={viewModel(NEVER_ACTIVATED)} canActivate />);

    expect(screen.getByText("No licence has been activated")).toBeTruthy();
    expect(screen.getByText(EMPTY_STATE_BODY)).toBeTruthy();
    expect(screen.getAllByText("Not activated").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Not available").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("Not checked yet")).toBeTruthy();
    // No figure markup and no banner-like status block.
    expect(container.querySelector(".text-\\[28px\\]")).toBeNull();
    expect(screen.queryByText("days remaining")).toBeNull();
    expect(screen.queryByText(/What happens after/)).toBeNull();
    expect(screen.getByText(RENEWAL_FALLBACK)).toBeTruthy();
  });
});

describe("LicenceStatusView: the rail", () => {
  it("omits the exports link without reports.view and shows it with reports.view", () => {
    const { unmount } = render(
      <LicenceStatusView vm={viewModel({}, { canViewReports: false })} canActivate diagnosticSlot={<button type="button">Diag</button>} />,
    );
    expect(screen.queryByRole("link", { name: "Open data exports" })).toBeNull();
    expect(screen.queryByText(EXPORTS_HELPER)).toBeNull();
    expect(screen.getByRole("button", { name: "Diag" })).toBeTruthy();
    expect(screen.getByText(DIAGNOSTIC_HELPER)).toBeTruthy();
    unmount();

    render(<LicenceStatusView vm={viewModel()} canActivate />);
    const link = screen.getByRole("link", { name: "Open data exports" });
    expect(link.getAttribute("href")).toBe("/staff/reports");
    expect(screen.getByText(EXPORTS_HELPER)).toBeTruthy();
  });

  it("draws no empty Data and diagnostics heading with no slot and no reports access", () => {
    render(<LicenceStatusView vm={viewModel({}, { canViewReports: false })} canActivate />);
    expect(screen.queryByRole("heading", { name: "Data and diagnostics" })).toBeNull();
  });

  it("links the renewal and support emails and shows phone and hours when present", () => {
    render(<LicenceStatusView vm={viewModel()} canActivate />);
    expect(screen.getByRole("link", { name: "renewals@provider.example" }).getAttribute("href")).toBe(
      "mailto:renewals@provider.example",
    );
    expect(screen.getByRole("link", { name: "support@provider.example" }).getAttribute("href")).toBe(
      "mailto:support@provider.example",
    );
    expect(screen.getByText("+234 800 000 0000")).toBeTruthy();
    expect(screen.getByText("Mon to Fri, 09:00 to 17:00 WAT")).toBeTruthy();
  });

  it("omits the phone and hours rows when absent", () => {
    render(
      <LicenceStatusView
        vm={viewModel({
          support: { renewalEmail: "renewals@provider.example", supportEmail: "support@provider.example", phone: null, hours: null },
        })}
        canActivate
      />,
    );
    expect(screen.queryByText("Phone")).toBeNull();
    expect(screen.queryByText("Hours")).toBeNull();
    expect(screen.getByText("Support email")).toBeTruthy();
  });

  it("shows the agreement fallback line when the deployment has no payload", () => {
    render(<LicenceStatusView vm={viewModel({ support: null })} canActivate />);
    expect(screen.getByText("Use the support contact on your agreement.")).toBeTruthy();
    expect(screen.queryByText("Renewal email")).toBeNull();
  });
});

describe("LicenceStatusView: notes and states", () => {
  it("shows the clock-rollback warning naming the date only while clockAlertAt is set", () => {
    const { unmount } = render(
      <LicenceStatusView vm={viewModel({ clockAlertAt: new Date("2026-09-30T10:00:00.000Z") })} canActivate />,
    );
    expect(
      screen.getByText("The server clock moved backwards on 30 Sep 2026, 11:00 WAT. Check the server's time settings."),
    ).toBeTruthy();
    unmount();

    render(<LicenceStatusView vm={viewModel()} canActivate />);
    expect(screen.queryByText(/The server clock moved backwards/)).toBeNull();
  });

  it("restricted: no figure, the since caption and the blocked capabilities as list items", () => {
    const vm = viewModel({
      state: "RESTRICTED_CONTINUITY",
      isRestricted: true,
      expiresAt: new Date(NOW.getTime() - 17 * DAY_MS),
      graceEndsAt: new Date("2026-09-28T22:59:59.000Z"),
      restrictedAt: new Date("2026-09-28T22:59:59.000Z"),
      daysRemaining: null,
    });
    const { container } = render(<LicenceStatusView vm={vm} canActivate />);

    expect(screen.getByText("Restricted since 28 Sep 2026, 23:59 WAT")).toBeTruthy();
    expect(container.querySelector(".text-\\[28px\\]")).toBeNull();
    expect(screen.queryByText(NOTHING_BLOCKED)).toBeNull();
    const blockedHeading = screen.getByRole("heading", { name: "What is blocked" });
    const panel = blockedHeading.parentElement as HTMLElement;
    expect(within(panel).getAllByRole("listitem")).toHaveLength(RESTRICTED_CAPABILITIES.blocked.length);
  });

  it("an under-24-hours figure drops to the 22px heading size so it never wraps mid-number", () => {
    const vm = buildLicenceStatusView(
      snapshot({ expiresAt: new Date("2026-10-01T23:00:00.000Z"), graceEndsAt: new Date("2026-10-15T23:00:00.000Z") }),
      { canActivate: true, canViewReports: true, now: NOW },
    );
    const { container } = render(<LicenceStatusView vm={vm} canActivate />);
    const figure = screen.getByText("Under 24 hours");
    expect(figure.className).toContain("text-[22px]");
    expect(container.querySelector(".text-\\[28px\\]")).toBeNull();
  });

  it("denied renders the DetailLayout denied copy with the licence.view phrase and none of the licence detail", () => {
    render(<LicenceStatusView vm={viewModel()} canActivate state={{ status: "denied", permission: "licence.view" }} />);
    expect(screen.getByText("You do not have access to this record")).toBeTruthy();
    expect(screen.getByText(/permission to view licence here/)).toBeTruthy();
    for (const hidden of ["LIC-2026-0001", "fixture-deployment-0001", "Fixture Training Academy", "182", "What works"]) {
      expect(screen.queryByText(hidden), hidden).toBeNull();
    }
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("error renders the load-error copy and none of the licence detail", () => {
    render(<LicenceStatusView canActivate={false} state={{ status: "error", message: LOAD_ERROR_MESSAGE }} />);
    expect(screen.getByText("Couldn't load licence status. Reload the page; if it persists, contact support.")).toBeTruthy();
    expect(screen.queryByText("What works")).toBeNull();
  });

  it("a ready state with no view model is a load failure, never an empty screen", () => {
    render(<LicenceStatusView canActivate={false} />);
    expect(screen.getByText("Could not load this record")).toBeTruthy();
  });

  it("loading renders the aria-busy skeleton", () => {
    const { container } = render(<LicenceStatusView canActivate={false} state={{ status: "loading" }} />);
    expect(container.querySelector("[aria-busy]")).not.toBeNull();
  });
});

describe("LicenceStatusView: long text (class contract; the visual check is a human backstop)", () => {
  it("wraps a 200-character client name with break-words and a 120-character renewal email with break-all, without truncating", () => {
    const clientName = `Client ${"N".repeat(193)}`;
    const renewalEmail = `${"r".repeat(100)}@${"d".repeat(19)}.example`;
    expect(clientName).toHaveLength(200);
    expect(renewalEmail.length).toBeGreaterThanOrEqual(120);
    const vm = viewModel({
      clientName,
      support: { renewalEmail, supportEmail: "support@provider.example", phone: null, hours: null },
    });
    const { container } = render(<LicenceStatusView vm={vm} canActivate />);

    const client = screen.getByText(clientName);
    expect(client.className).toContain("break-words");
    expect(client.className).not.toMatch(/truncate|line-clamp/);
    const emailLink = screen.getByRole("link", { name: renewalEmail });
    expect(emailLink.className).toContain("break-all");
    // The subtitle copy of the email wraps too.
    const subtitleCopies = screen.getAllByText(renewalEmail);
    expect(subtitleCopies.some((node) => node.className.includes("break-all"))).toBe(true);
    expect(container.querySelector(".truncate")).toBeNull();
  });
});

describe("CopyButton on the deployment ID", () => {
  it("copies the deployment ID and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<LicenceStatusView vm={viewModel()} canActivate />);

    fireEvent.click(screen.getByRole("button", { name: "Copy deployment ID" }));
    expect(writeText).toHaveBeenCalledWith("fixture-deployment-0001");
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
  });

  it("is absent when there is no deployment ID", () => {
    render(<LicenceStatusView vm={viewModel({ deploymentId: null })} canActivate />);
    expect(screen.queryByRole("button", { name: "Copy deployment ID" })).toBeNull();
  });
});
