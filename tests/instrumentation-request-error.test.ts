/**
 * `onRequestError` in `src/instrumentation.ts` (plan 15-06; NFR-07, D-18,
 * T-15-06-03).
 *
 * Every server error must produce exactly one structured JSON line in the host
 * log so an error-rate change is visible without a vendor, and that line must
 * carry no personal data: the route template instead of the concrete path, the
 * error name and digest instead of the message, and never a query string,
 * header or cookie value. `register()` must stay exactly as it was.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Instrumentation } from "next";
import * as instrumentation from "@/instrumentation";

type OnRequestError = Instrumentation.onRequestError;
type ErrorRequest = Parameters<OnRequestError>[1];
type ErrorContext = Parameters<OnRequestError>[2];

const INSTRUMENTATION_FILE = path.resolve(import.meta.dirname, "..", "src", "instrumentation.ts");

const CONCRETE_ID = "enr_7f3c2a9b1d";
const QUERY_STRING = "email=ada.learner%40example.com&token=reset-secret-123";
const ERROR_MESSAGE = "Learner ada.learner@example.com has no access to enrolment";

const request: ErrorRequest = {
  path: `/learn/${CONCRETE_ID}?${QUERY_STRING}`,
  method: "GET",
  headers: {
    cookie: "lms.session=session-cookie-secret",
    authorization: "Bearer header-secret-token",
    "x-forwarded-for": "203.0.113.42",
  },
};

const context: ErrorContext = {
  routerKind: "App Router",
  routePath: "/learn/[enrolmentId]",
  routeType: "render",
  renderSource: "react-server-components",
  revalidateReason: undefined,
};

function digestError(): Error & { digest: string } {
  const error = new Error(ERROR_MESSAGE) as Error & { digest: string };
  error.name = "EnrolmentAccessError";
  error.digest = "3214567890";
  return error;
}

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function loggedLines(): string[] {
  return errorSpy.mock.calls.map((call) => call.map(String).join(" "));
}

describe("onRequestError", () => {
  it("is exported alongside register", () => {
    expect(typeof instrumentation.onRequestError).toBe("function");
    expect(typeof instrumentation.register).toBe("function");
  });

  it("writes exactly one JSON line with event, routePath, routeType, method, errorName and digest", async () => {
    await instrumentation.onRequestError(digestError(), request, context);

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed).toEqual({
      event: "request_error",
      routePath: "/learn/[enrolmentId]",
      routeType: "render",
      method: "GET",
      errorName: "EnrolmentAccessError",
      digest: "3214567890",
    });
  });

  it("never logs the concrete path segment, the query string, the message, headers or cookies", async () => {
    await instrumentation.onRequestError(digestError(), request, context);

    const line = loggedLines()[0];
    expect(line).not.toContain(CONCRETE_ID);
    expect(line).not.toContain(`/learn/${CONCRETE_ID}`);
    expect(line).not.toContain("?");
    expect(line).not.toContain("email=");
    expect(line).not.toContain("reset-secret-123");
    expect(line).not.toContain("ada.learner");
    expect(line).not.toContain(ERROR_MESSAGE);
    expect(line).not.toContain("has no access");
    expect(line).not.toContain("session-cookie-secret");
    expect(line).not.toContain("header-secret-token");
    expect(line).not.toContain("203.0.113.42");
    expect(line).not.toContain("stack");
  });

  it("uses UnknownError and omits the digest when the thrown value is not an Error", async () => {
    await instrumentation.onRequestError("plain string with ada.learner@example.com", request, context);

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.event).toBe("request_error");
    expect(parsed.errorName).toBe("UnknownError");
    expect(parsed.digest).toBeUndefined();
    expect(lines[0]).not.toContain("ada.learner");
  });

  it("keeps a digest carried by a non-Error object but never its other fields", async () => {
    const thrown = { digest: "NEXT_NOT_FOUND", message: "secret detail" };

    await instrumentation.onRequestError(thrown, request, context);

    const parsed = JSON.parse(loggedLines()[0]) as Record<string, unknown>;
    expect(parsed.errorName).toBe("UnknownError");
    expect(parsed.digest).toBe("NEXT_NOT_FOUND");
    expect(loggedLines()[0]).not.toContain("secret detail");
  });

  it("never throws, even with null inputs or when console.error itself throws", async () => {
    await expect(
      instrumentation.onRequestError(
        null,
        null as unknown as ErrorRequest,
        null as unknown as ErrorContext,
      ),
    ).resolves.toBeUndefined();

    errorSpy.mockImplementation(() => {
      throw new Error("log sink down");
    });
    await expect(instrumentation.onRequestError(digestError(), request, context)).resolves.toBeUndefined();
  });
});

describe("register stays unchanged", () => {
  const source = readFileSync(INSTRUMENTATION_FILE, "utf8");

  it("keeps the NEXT_RUNTIME guard and the best-effort licence startup check", () => {
    expect(source).toContain('if (process.env.NEXT_RUNTIME !== "nodejs")');
    expect(source).toContain('await import("@/server/services/licence-startup-service")');
    expect(source).toContain("await runStartupLicenceCheck();");
  });

  it("returns without loading the licence check outside the Node.js runtime", async () => {
    const previous = process.env.NEXT_RUNTIME;
    process.env.NEXT_RUNTIME = "edge";
    try {
      await expect(instrumentation.register()).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_RUNTIME;
      } else {
        process.env.NEXT_RUNTIME = previous;
      }
    }
  });
});
