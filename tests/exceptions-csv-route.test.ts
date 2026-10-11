import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/staff/cohorts/[id]/exceptions/csv` exercised directly with a constructed
 * Request and a doubled roster service (Phase 15, plan 15-27, Task 2; NFR-06,
 * ledger P-07, T-15-27-01).
 *
 * Denial parity is the load-bearing property: every private download answers a
 * refusal with the same empty 404 (the other routes' rule), so a denial never
 * tells a caller whether a cohort or an export exists. This route used to answer
 * 403 with a message body; the cases below pin the 404 and compare the denial
 * responses byte for byte (status, body, and the headers a cache would read).
 */

const h = vi.hoisted(() => ({
  loadAttendanceExceptions: vi.fn(),
  exceptionsToCsv: vi.fn((rows: unknown[]) => `header\n${rows.length}\n`),
}));

class AuthenticationError extends Error {}
class AuthorizationError extends Error {}

vi.mock("@/server/permissions", () => ({ AuthenticationError, AuthorizationError }));

vi.mock("@/server/services/roster-service", () => ({
  loadAttendanceExceptions: h.loadAttendanceExceptions,
  exceptionsToCsv: h.exceptionsToCsv,
}));

const { GET } = await import("@/app/staff/cohorts/[id]/exceptions/csv/route");

const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (query = "") => new Request(`http://localhost:3000/staff/cohorts/c1/exceptions/csv${query}`);

async function snapshot(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    cacheControl: response.headers.get("cache-control"),
    contentType: response.headers.get("content-type"),
    disposition: response.headers.get("content-disposition"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("attendance exceptions CSV route: denial parity (P-07)", () => {
  it("answers a caller without attendance.view with an empty 404 that is never cached", async () => {
    h.loadAttendanceExceptions.mockRejectedValueOnce(new AuthorizationError("denied"));

    const denied = await snapshot(await GET(request(), routeCtx("c1")));

    expect(denied.status).toBe(404);
    expect(denied.body).toBe("");
    expect(denied.cacheControl).toBe("private, no-store");
    expect(denied.disposition).toBeNull();
  });

  it("answers a visitor with no session with the same empty 404", async () => {
    h.loadAttendanceExceptions.mockRejectedValueOnce(new AuthenticationError("no session"));

    const denied = await snapshot(await GET(request(), routeCtx("c1")));

    expect(denied.status).toBe(404);
    expect(denied.body).toBe("");
  });

  it("answers an unknown cohort (the service refuses an empty scope) exactly like a forbidden one", async () => {
    h.loadAttendanceExceptions.mockRejectedValueOnce(new AuthorizationError("unknown cohort"));
    const unknown = await snapshot(await GET(request(), routeCtx("does-not-exist")));

    h.loadAttendanceExceptions.mockRejectedValueOnce(new AuthorizationError("forbidden"));
    const forbidden = await snapshot(await GET(request(), routeCtx("c1")));

    h.loadAttendanceExceptions.mockRejectedValueOnce(new AuthenticationError("no session"));
    const anonymous = await snapshot(await GET(request(), routeCtx("c1")));

    expect(unknown).toEqual(forbidden);
    expect(anonymous).toEqual(forbidden);
    expect(forbidden.status).toBe(404);
    expect(forbidden.body).toBe("");
  });

  it("never answers a refusal with 403, whatever caused it", async () => {
    for (const error of [new AuthorizationError("a"), new AuthenticationError("b")]) {
      h.loadAttendanceExceptions.mockRejectedValueOnce(error);
      const response = await GET(request(), routeCtx("c1"));
      expect(response.status).not.toBe(403);
    }
  });

  it("does not swallow an unexpected failure as a denial", async () => {
    h.loadAttendanceExceptions.mockRejectedValueOnce(new Error("database is down"));
    await expect(GET(request(), routeCtx("c1"))).rejects.toThrow("database is down");
  });
});

describe("attendance exceptions CSV route: an authorised caller", () => {
  it("receives the CSV as an attachment with Cache-Control private, no-store", async () => {
    h.loadAttendanceExceptions.mockResolvedValueOnce([{ learnerName: "A" }, { learnerName: "B" }]);

    const response = await GET(request(), routeCtx("c1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="attendance-exceptions-c1-.+\.csv"$/);
    expect(await response.text()).toBe("header\n2\n");
  });

  it("hands the same cohort id and filters to the service that the page uses", async () => {
    h.loadAttendanceExceptions.mockResolvedValueOnce([]);

    await GET(request("?categories=AT_RISK,DISPUTED&search=ada"), routeCtx("c9"));

    expect(h.loadAttendanceExceptions).toHaveBeenCalledWith({
      cohortId: "c9",
      categories: ["AT_RISK", "DISPUTED"],
      search: "ada",
    });
  });

  it("builds the filename only after authorization, so a refusal never carries the cohort id", async () => {
    h.loadAttendanceExceptions.mockRejectedValueOnce(new AuthorizationError("denied"));

    const denied = await GET(request(), routeCtx("secret-cohort-id"));

    expect(denied.headers.get("content-disposition")).toBeNull();
    expect(await denied.text()).not.toContain("secret-cohort-id");
  });
});
