/**
 * Neon branch helper, pure parts and the API calls with fetch mocked (plan
 * 15-29; D-01, D-04, NFR-08). No test here reaches the network.
 *
 * Pinned: argument parsing, the restore-point timestamp format, the create
 * and delete name rules (the default branch is never deleted), the request
 * body of a point-in-time branch, waiting until ready, and that the tool
 * never calls a restore endpoint or prints a host, a key or a connection
 * string.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEON_API_BASE,
  assertCreatableName,
  assertDeletableBranch,
  assertRestoreTimestamp,
  createNeonClient,
  parseArgs,
  safeMessage,
  type FetchLike,
  type NeonBranch,
} from "../scripts/ops/neon-branch";

const NOW = new Date("2026-10-11T12:00:00Z");
const API_KEY = "napi_testkey0123456789";
const PROJECT = "quiet-bird-123456";
const ENDPOINT_HOST = "ep-quiet-bird-a1b2c3.eu-central-1.aws.neon.tech";

const PRODUCTION: NeonBranch = { id: "br-prod-1", name: "production", current_state: "ready", default: true };
const STAGING: NeonBranch = { id: "br-stage-1", name: "staging-phase 15", current_state: "ready", default: false };
const REHEARSAL: NeonBranch = { id: "br-reh-1", name: "restore-rehearsal-20261011-1200", current_state: "ready" };

type Call = { method: string; path: string; body: unknown; headers: Record<string, string> };

/** A fetch stand-in: records calls and answers from a route table. */
function mockFetch(routes: Record<string, (call: Call) => { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const prefix = `${NEON_API_BASE}/projects/${PROJECT}`;
    expect(url.startsWith(prefix)).toBe(true);
    const call: Call = {
      method: init.method,
      path: url.slice(prefix.length),
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      headers: init.headers,
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    if (!route) return { ok: false, status: 404, text: async () => JSON.stringify({ message: "not found" }) };
    const { status = 200, json } = route(call);
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(json) };
  };
  return { fetch, calls };
}

function client(fetch: FetchLike) {
  return createNeonClient({ apiKey: API_KEY, projectId: PROJECT, fetch, pollMs: 0, now: () => NOW.getTime() });
}

describe("parseArgs", () => {
  it("parses list", () => {
    expect(parseArgs(["list"], NOW)).toEqual({ command: "list" });
  });

  it("parses create with a restore point and a read-write endpoint by default", () => {
    expect(
      parseArgs(["create", "--parent", "staging-phase 15", "--name", "restore-rehearsal-1", "--at", "2026-10-11T11:55:00Z"], NOW),
    ).toEqual({
      command: "create",
      parent: "staging-phase 15",
      name: "restore-rehearsal-1",
      at: "2026-10-11T11:55:00Z",
      endpoint: true,
    });
  });

  it("parses create without a restore point, the = form and --no-endpoint", () => {
    expect(parseArgs(["create", "--parent=br-stage-1", "--name=staging-two", "--no-endpoint"], NOW)).toEqual({
      command: "create",
      parent: "br-stage-1",
      name: "staging-two",
      at: null,
      endpoint: false,
    });
  });

  it("parses wait and delete", () => {
    expect(parseArgs(["wait", "--branch", "br-reh-1"], NOW)).toEqual({ command: "wait", branch: "br-reh-1", timeoutSeconds: 300 });
    expect(parseArgs(["wait", "--branch", "br-reh-1", "--timeout-seconds", "60"], NOW)).toMatchObject({ timeoutSeconds: 60 });
    expect(parseArgs(["delete", "--branch", "restore-rehearsal-1"], NOW)).toEqual({
      command: "delete",
      branch: "restore-rehearsal-1",
      allowStaging: false,
    });
    expect(parseArgs(["delete", "--branch", "staging-two", "--allow-staging"], NOW)).toMatchObject({ allowStaging: true });
  });

  it("rejects missing, unknown, repeated and malformed arguments", () => {
    expect(() => parseArgs([], NOW)).toThrow("No command given.");
    expect(() => parseArgs(["restore", "--branch", "production"], NOW)).toThrow("Unknown command");
    expect(() => parseArgs(["create", "--name", "restore-rehearsal-1"], NOW)).toThrow("create needs --parent.");
    expect(() => parseArgs(["create", "--parent", "production"], NOW)).toThrow("create needs --name.");
    expect(() => parseArgs(["delete"], NOW)).toThrow("delete needs --branch.");
    expect(() => parseArgs(["delete", "--branch"], NOW)).toThrow("--branch needs a value.");
    expect(() => parseArgs(["delete", "--branch", "a", "--branch", "b"], NOW)).toThrow("given twice");
    expect(() => parseArgs(["delete", "--branch", "a", "--force"], NOW)).toThrow("--force needs a value.");
    expect(() => parseArgs(["list", "--verbose=1"], NOW)).toThrow("Unknown option --verbose for list.");
    expect(() => parseArgs(["wait", "--branch", "a", "--timeout-seconds", "0"], NOW)).toThrow("between 1 and 3600");
    expect(() => parseArgs(["wait", "--branch", "a", "--allow-staging=1"], NOW)).toThrow("takes no value");
  });

  it("does not echo a stray value, which could be a pasted secret", () => {
    const stray = "postgresql://owner:s3cret@host/db";
    let message = "";
    try {
      parseArgs(["delete", stray], NOW);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("s3cret");
  });

  it("applies the name rule and the timestamp rule while parsing create", () => {
    expect(() => parseArgs(["create", "--parent", "production", "--name", "copy-of-prod"], NOW)).toThrow("Refusing to create");
    expect(() =>
      parseArgs(["create", "--parent", "production", "--name", "restore-rehearsal-1", "--at", "yesterday"], NOW),
    ).toThrow("RFC 3339");
  });
});

describe("assertRestoreTimestamp", () => {
  it("accepts RFC 3339 times with Z, an offset and fractional seconds", () => {
    for (const value of ["2026-10-11T11:55:00Z", "2026-10-11T12:55:00+01:00", "2026-10-11T11:55:00.123Z"]) {
      expect(assertRestoreTimestamp(value, NOW)).toBe(value);
    }
  });

  it("rejects other shapes", () => {
    for (const value of [
      "2026-10-11",
      "2026-10-11 11:55:00Z",
      "2026-10-11T11:55Z",
      "2026-10-11T11:55:00",
      "2026-10-11T11:55:00z",
      "11/10/2026 11:55",
      "1791719700",
      "",
    ]) {
      expect(() => assertRestoreTimestamp(value, NOW)).toThrow("RFC 3339");
    }
  });

  it("rejects an impossible date and a time in the future", () => {
    expect(() => assertRestoreTimestamp("2026-13-45T11:55:00Z", NOW)).toThrow("not a real date");
    expect(() => assertRestoreTimestamp("2026-10-11T12:00:01Z", NOW)).toThrow("in the future");
  });
});

describe("name rules", () => {
  it("only creates staging- and restore-rehearsal- branches", () => {
    expect(assertCreatableName("restore-rehearsal-20261011-1200")).toBe("restore-rehearsal-20261011-1200");
    expect(assertCreatableName("staging-phase 15")).toBe("staging-phase 15");
    for (const name of ["production", "main", "restore-rehearsal-", "staging-", "my-restore-rehearsal-1", "Restore-Rehearsal-1", ""]) {
      expect(() => assertCreatableName(name)).toThrow("Refusing to create");
    }
  });

  it("deletes a rehearsal branch", () => {
    expect(() => assertDeletableBranch(REHEARSAL)).not.toThrow();
  });

  it("refuses to delete a branch whose name lacks the staging- or restore-rehearsal- prefix", () => {
    for (const name of ["production", "prod_test2", "main", "my-staging-1", "x-restore-rehearsal-1", "RESTORE-REHEARSAL-1", ""]) {
      expect(() => assertDeletableBranch({ id: "br-x", name })).toThrow("Refusing to delete");
      expect(() => assertDeletableBranch({ id: "br-x", name }, { allowStaging: true })).toThrow("Refusing to delete");
    }
  });

  it("deletes a staging branch only with the explicit opt-in", () => {
    expect(() => assertDeletableBranch(STAGING)).toThrow("without --allow-staging");
    expect(() => assertDeletableBranch(STAGING, { allowStaging: true })).not.toThrow();
  });

  it("never deletes the default, a primary or a protected branch, whatever its name", () => {
    expect(() => assertDeletableBranch({ ...REHEARSAL, default: true })).toThrow("default branch");
    expect(() => assertDeletableBranch({ ...REHEARSAL, primary: true })).toThrow("default branch");
    expect(() => assertDeletableBranch({ ...REHEARSAL, protected: true })).toThrow("protected branch");
    expect(() => assertDeletableBranch({ ...STAGING, default: true }, { allowStaging: true })).toThrow("default branch");
  });
});

describe("createNeonClient", () => {
  it("needs the key and a project id", () => {
    expect(() => createNeonClient({ apiKey: "", projectId: PROJECT })).toThrow("NEON_API_KEY is not set");
    expect(() => createNeonClient({ apiKey: API_KEY, projectId: undefined })).toThrow("NEON_PROJECT_ID");
    expect(() => createNeonClient({ apiKey: API_KEY, projectId: "../other" })).toThrow("NEON_PROJECT_ID");
  });

  it("creates a point-in-time branch from the parent's id with a read-write endpoint", async () => {
    const { fetch, calls } = mockFetch({
      "GET /branches": () => ({ json: { branches: [PRODUCTION, STAGING] } }),
      "POST /branches": () => ({
        status: 201,
        json: { branch: { ...REHEARSAL, current_state: "init" }, operations: [{ id: "op-1", status: "running" }] },
      }),
    });
    const created = await client(fetch).createBranch({
      parent: "staging-phase 15",
      name: REHEARSAL.name,
      at: "2026-10-11T11:55:00Z",
    });
    expect(created).toEqual({ branch: { ...REHEARSAL, current_state: "init" }, operationIds: ["op-1"] });
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.body).toEqual({
      branch: { parent_id: "br-stage-1", name: REHEARSAL.name, parent_timestamp: "2026-10-11T11:55:00Z" },
      endpoints: [{ type: "read_write" }],
    });
    expect(post.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls.every((call) => !call.path.includes("restore"))).toBe(true);
  });

  it("refuses a bad name, a future restore point, an unknown parent and a duplicate name before any POST", async () => {
    const { fetch, calls } = mockFetch({
      "GET /branches": () => ({ json: { branches: [PRODUCTION, STAGING, REHEARSAL] } }),
    });
    const neon = client(fetch);
    await expect(neon.createBranch({ parent: STAGING.id, name: "copy-of-prod" })).rejects.toThrow("Refusing to create");
    await expect(
      neon.createBranch({ parent: STAGING.id, name: "restore-rehearsal-2", at: "2026-10-12T00:00:00Z" }),
    ).rejects.toThrow("in the future");
    await expect(neon.createBranch({ parent: "no-such-branch", name: "restore-rehearsal-2" })).rejects.toThrow("No branch has");
    await expect(neon.createBranch({ parent: STAGING.id, name: REHEARSAL.name })).rejects.toThrow("already exists");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("waits until the operations finish and the branch and endpoint are ready", async () => {
    let operationPolls = 0;
    let branchPolls = 0;
    const { fetch } = mockFetch({
      "GET /operations/op-1": () => ({ json: { operation: { id: "op-1", status: ++operationPolls < 3 ? "running" : "finished" } } }),
      "GET /branches/br-reh-1": () => ({ json: { branch: { ...REHEARSAL, current_state: ++branchPolls < 2 ? "init" : "ready" } } }),
      "GET /branches/br-reh-1/endpoints": () => ({
        json: { endpoints: [{ id: "ep-1", host: ENDPOINT_HOST, type: "read_write", branch_id: "br-reh-1", current_state: "active" }] },
      }),
    });
    const ready = await client(fetch).waitUntilReady("br-reh-1", { operationIds: ["op-1"] });
    expect(ready.current_state).toBe("ready");
    expect(operationPolls).toBe(3);
    expect(branchPolls).toBe(2);
  });

  it("stops waiting when an operation fails or time runs out", async () => {
    const failed = mockFetch({
      "GET /operations/op-1": () => ({ json: { operation: { id: "op-1", status: "failed", action: "create_branch" } } }),
    });
    await expect(client(failed.fetch).waitUntilReady("br-reh-1", { operationIds: ["op-1"] })).rejects.toThrow(
      "create_branch ended as failed",
    );

    let clock = NOW.getTime();
    const stuck = mockFetch({ "GET /branches/br-reh-1": () => ({ json: { branch: { ...REHEARSAL, current_state: "init" } } }) });
    const neon = createNeonClient({
      apiKey: API_KEY,
      projectId: PROJECT,
      fetch: stuck.fetch,
      pollMs: 0,
      now: () => (clock += 1000),
    });
    await expect(neon.waitUntilReady("br-reh-1", { timeoutSeconds: 3 })).rejects.toThrow("did not become ready in time");
  });

  it("deletes a rehearsal branch by name and sends no DELETE for a refused branch", async () => {
    const { fetch, calls } = mockFetch({
      "GET /branches": () => ({ json: { branches: [PRODUCTION, STAGING, REHEARSAL] } }),
      "DELETE /branches/br-reh-1": () => ({ json: { branch: REHEARSAL, operations: [] } }),
    });
    const neon = client(fetch);
    await expect(neon.deleteBranch(REHEARSAL.name)).resolves.toMatchObject({ id: "br-reh-1" });
    await expect(neon.deleteBranch("production")).rejects.toThrow("default branch");
    await expect(neon.deleteBranch("br-prod-1")).rejects.toThrow("default branch");
    await expect(neon.deleteBranch("staging-phase 15")).rejects.toThrow("without --allow-staging");
    await expect(neon.deleteBranch("no-such-branch")).rejects.toThrow("No branch has");
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual(["/branches/br-reh-1"]);
  });

  it("refuses any restore endpoint without sending a request", async () => {
    const { fetch, calls } = mockFetch({});
    await expect(client(fetch).request("POST", "/branches/br-prod-1/restore", { source_branch_id: "br-prod-1" })).rejects.toThrow(
      "Refusing to call a Neon restore endpoint",
    );
    expect(calls).toHaveLength(0);
  });

  it("reports an API failure with the status and without the key or a host", async () => {
    const { fetch } = mockFetch({
      "GET /branches": () => ({
        status: 403,
        json: { message: `key ${API_KEY} may not read ${ENDPOINT_HOST} postgresql://owner:s3cret@${ENDPOINT_HOST}/db` },
      }),
    });
    let message = "";
    try {
      await client(fetch).listBranches();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("status 403");
    expect(message).not.toContain(API_KEY);
    expect(message).not.toContain("neon.tech");
    expect(message).not.toContain("s3cret");
  });

  it("hands the endpoint host to callers", async () => {
    const { fetch } = mockFetch({
      "GET /branches/br-reh-1/endpoints": () => ({
        json: { endpoints: [{ id: "ep-1", host: ENDPOINT_HOST, type: "read_write", branch_id: "br-reh-1", current_state: "active" }] },
      }),
    });
    await expect(client(fetch).branchEndpointHost("br-reh-1")).resolves.toBe(ENDPOINT_HOST);
  });
});

describe("output hygiene", () => {
  it("safeMessage keeps one line and masks keys, connection strings and hosts", () => {
    const masked = safeMessage(`bad ${API_KEY} postgresql://u:p@${ENDPOINT_HOST}/db\nsecond line`, API_KEY);
    expect(masked).not.toContain(API_KEY);
    expect(masked).not.toContain("neon.tech");
    expect(masked).not.toContain("second line");
  });

  it("the command line never prints an endpoint host or a connection URI", () => {
    const source = readFileSync(path.resolve(__dirname, "../scripts/ops/neon-branch.ts"), "utf8");
    const cli = source.slice(source.indexOf("function describe("));
    expect(cli).not.toMatch(/\.host\b/);
    expect(cli).not.toContain("branchEndpointHost");
    expect(source).not.toContain("connection_uri");
  });
});
