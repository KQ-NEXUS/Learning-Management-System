/**
 * Plan 15-05 Task 1: LagosTime (D-17, UI-SPEC S6) and the support TicketTime
 * that renders through it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LagosTime } from "@/components/time/LagosTime";
import { TicketTime } from "@/components/support/ticket-labels";

afterEach(() => {
  cleanup();
});

describe("LagosTime", () => {
  it("wraps the Lagos text in a time element carrying the ISO UTC instant", () => {
    const { container } = render(<LagosTime value={new Date("2026-10-05T13:30:00Z")} />);
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBe("2026-10-05T13:30:00.000Z");
    expect(time?.textContent).toBe("5 Oct 2026, 14:30 WAT");
  });

  it("accepts an ISO string and renders the seconds and date variants", () => {
    const seconds = render(<LagosTime value="2026-10-05T13:30:12Z" variant="dateTimeSeconds" />);
    expect(seconds.container.querySelector("time")?.textContent).toBe("5 Oct 2026, 14:30:12 WAT");
    cleanup();
    const date = render(<LagosTime value="2026-10-05T23:30:00Z" variant="date" />);
    const time = date.container.querySelector("time");
    expect(time?.textContent).toBe("6 Oct 2026");
    expect(time?.getAttribute("datetime")).toBe("2026-10-05T23:30:00.000Z");
  });

  it("passes className to the time element", () => {
    const { container } = render(<LagosTime value="2026-10-05T13:30:00Z" className="font-mono" />);
    expect(container.querySelector("time")?.className).toBe("font-mono");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an unparseable string", "not a date"],
  ])("renders a plain dash and no time element for %s", (_label, value) => {
    const { container } = render(<LagosTime value={value} />);
    expect(container.querySelector("time")).toBeNull();
    expect(container.textContent).toBe("—");
  });
});

describe("TicketTime", () => {
  it("renders Lagos time ending in WAT, never UTC, with its existing classes", () => {
    const { container } = render(<TicketTime value="2026-10-05T13:30:00Z" />);
    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-10-05T13:30:00.000Z");
    expect(time?.textContent).toBe("5 Oct 2026, 14:30 WAT");
    expect(time?.textContent?.endsWith(" WAT")).toBe(true);
    expect(container.textContent).not.toContain("UTC");
    expect(time?.className).toBe("font-mono text-xs text-muted-foreground");
  });
});
