/**
 * `GET|HEAD /api/health` (plan 15-06; NFR-01, D-18, T-15-06-01, T-15-06-04).
 *
 * The health service is mocked: this file proves the route's mapping from the
 * ping answer to a fixed body, status code and no-store header, and that
 * nothing else (error text, stack, version, host) can reach the response.
 * `tests/health-service.integration.test.ts` proves the ping itself against a
 * real Postgres.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const mocks = vi.hoisted(() => ({
  pingDatabase: vi.fn(),
}));

vi.mock("@/server/services/health-service", () => ({
  healthService: { pingDatabase: mocks.pingDatabase },
}));

import { GET, HEAD } from "@/app/api/health/route";

const ROUTE_FILE = path.resolve(import.meta.dirname, "..", "src", "app", "api", "health", "route.ts");

/** Words and values that must never appear in a health response body. */
const FORBIDDEN_BODY_FRAGMENTS = ["error", "stack", "version", "localhost", "neon", "postgres", "host"];

function expectNoLeak(body: string): void {
  const lower = body.toLowerCase();
  for (const fragment of FORBIDDEN_BODY_FRAGMENTS) {
    expect(lower).not.toContain(fragment);
  }
}

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  mocks.pingDatabase.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("GET /api/health", () => {
  it("returns 200 with exactly {\"status\":\"ok\"} and no-store when the ping succeeds", async () => {
    mocks.pingDatabase.mockResolvedValue(true);

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('{"status":"ok"}');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.pingDatabase).toHaveBeenCalledWith(2000);
    expectNoLeak(body);
  });

  it("returns 503 with exactly {\"status\":\"degraded\"} and no-store when the ping fails", async () => {
    mocks.pingDatabase.mockResolvedValue(false);

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"status":"degraded"}');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expectNoLeak(body);
  });

  it("returns 503 degraded when the service throws, and the body carries none of the error", async () => {
    const failure = new Error("connect ECONNREFUSED db.internal-host.example:5432 version 16.4");
    failure.stack = "Error: secret stack trace at db.internal-host.example";
    mocks.pingDatabase.mockRejectedValue(failure);

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"status":"degraded"}');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expectNoLeak(body);
    expect(body).not.toContain("ECONNREFUSED");
    expect(body).not.toContain("internal-host");
  });

  it("logs only the error name, with a [health] prefix, when the service throws", async () => {
    const failure = new TypeError("leaky message with db.internal-host.example");
    mocks.pingDatabase.mockRejectedValue(failure);

    await GET();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("[health]");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("leaky message");
    expect(logged).not.toContain("internal-host");
  });

  it("logs UnknownError when the service throws a non-Error value", async () => {
    mocks.pingDatabase.mockRejectedValue("raw string with secret");

    const response = await GET();

    expect(response.status).toBe(503);
    const logged = errorSpy.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("UnknownError");
    expect(logged).not.toContain("secret");
  });
});

describe("HEAD /api/health", () => {
  it("mirrors the ok status with an empty body and no-store", async () => {
    mocks.pingDatabase.mockResolvedValue(true);

    const response = await HEAD();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("mirrors the degraded status with an empty body and no-store", async () => {
    mocks.pingDatabase.mockResolvedValue(false);

    const response = await HEAD();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 503 with an empty body when the service throws", async () => {
    mocks.pingDatabase.mockRejectedValue(new Error("boom"));

    const response = await HEAD();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});

describe("route file gates", () => {
  const source = readFileSync(ROUTE_FILE, "utf8");

  it("never imports Prisma or the db singleton directly", () => {
    expect(source).not.toMatch(/from\s+["']@prisma\/client["']/);
    expect(source).not.toMatch(/from\s+["']@\/server\/db["']/);
  });

  it("adds no segment config that could opt the route into caching", () => {
    expect(source).not.toMatch(/export\s+const\s+(dynamic|revalidate|fetchCache)\b/);
    expect(source).not.toContain("use cache");
  });
});
