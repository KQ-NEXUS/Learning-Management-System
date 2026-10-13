/**
 * `npx tsx scripts/ops/neon-branch.ts <command> [options]`
 *
 * Guarded helper for the Neon REST API (Phase 15, plan 15-29; D-01, D-04,
 * NFR-08). It exists so the staging setup and the point-in-time restore
 * rehearsal need no extra npm package and no neonctl.
 *
 *   list
 *       Prints every branch: id, name, state, default flag, created time.
 *   create --parent <branch id or name> --name <name> [--at <RFC 3339 time>] [--no-endpoint]
 *       Creates a NEW branch from the parent, optionally at a point in time,
 *       with a read-write compute endpoint, then waits until it is ready.
 *   wait --branch <branch id or name> [--timeout-seconds 300]
 *       Waits until the branch and its endpoint are ready.
 *   delete --branch <branch id or name> [--allow-staging]
 *       Deletes a branch this tool is allowed to delete (rules below).
 *
 * Environment (shell only, never a file): NEON_API_KEY, NEON_PROJECT_ID.
 *
 * Safety (threat T-15-29-03, T-15-29-04):
 *   - It only ever creates branches. It never calls a restore endpoint: an
 *     in-place restore rewrites the branch it runs on, so `request` refuses any
 *     path that contains "/restore".
 *   - New branch names must start with "staging-" or "restore-rehearsal-".
 *   - Delete refuses the default (production) branch, a primary or protected
 *     branch, and any branch whose name does not start with
 *     "restore-rehearsal-" or "staging-". A "staging-" branch additionally
 *     needs --allow-staging, because other plans depend on it.
 *   - Output is branch ids, names, states and times only. It never prints a
 *     connection string, a host name, a role, a password or the API key. The
 *     endpoint host is available to other scripts through `branchEndpointHost`
 *     and is never written to the terminal by this file.
 *
 * Exit codes: 0 done; 1 refused or the API call failed; 2 bad arguments.
 */

export const NEON_API_BASE = "https://console.neon.tech/api/v2";
export const REHEARSAL_PREFIX = "restore-rehearsal-";
export const STAGING_PREFIX = "staging-";
export const DEFAULT_WAIT_SECONDS = 300;

export const USAGE = [
  "Usage: npx tsx scripts/ops/neon-branch.ts list",
  "       npx tsx scripts/ops/neon-branch.ts create --parent <branch id or name> --name <name> [--at <RFC 3339 time>] [--no-endpoint]",
  "       npx tsx scripts/ops/neon-branch.ts wait --branch <branch id or name> [--timeout-seconds 300]",
  "       npx tsx scripts/ops/neon-branch.ts delete --branch <branch id or name> [--allow-staging]",
].join("\n");

export type Command =
  | { command: "list" }
  | { command: "create"; parent: string; name: string; at: string | null; endpoint: boolean }
  | { command: "wait"; branch: string; timeoutSeconds: number }
  | { command: "delete"; branch: string; allowStaging: boolean };

/** The parts of a Neon branch this tool reads. */
export type NeonBranch = {
  id: string;
  name: string;
  current_state?: string;
  default?: boolean;
  primary?: boolean;
  protected?: boolean;
  parent_id?: string;
  parent_timestamp?: string;
  created_at?: string;
};

type NeonOperation = { id: string; status: string; action?: string };
type NeonEndpoint = { id: string; host: string; type: string; branch_id: string; current_state?: string };

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * RFC 3339 date-time with seconds and an explicit offset ("Z" or +hh:mm), the
 * form Neon's `parent_timestamp` takes. Fractional seconds are allowed.
 */
const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** Returns the timestamp unchanged when valid; throws a plain message otherwise. */
export function assertRestoreTimestamp(value: string, now: Date = new Date()): string {
  if (!RFC_3339.test(value)) {
    throw new Error('--at must be an RFC 3339 time with seconds and an offset, for example "2026-10-06T08:00:00Z".');
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error("--at is not a real date and time.");
  if (ms > now.getTime()) throw new Error("--at is in the future; a restore point must be in the past.");
  return value;
}

/** A branch this tool creates must carry one of the two prefixes, so it can also remove it. */
export function assertCreatableName(name: string): string {
  const hasSuffix = (prefix: string) => name.startsWith(prefix) && name.length > prefix.length;
  if (!hasSuffix(REHEARSAL_PREFIX) && !hasSuffix(STAGING_PREFIX)) {
    throw new Error(`Refusing to create branch ${JSON.stringify(name)}: the name must start with "${REHEARSAL_PREFIX}" or "${STAGING_PREFIX}".`);
  }
  if (name.length > 256) throw new Error("The branch name is longer than 256 characters.");
  return name;
}

/**
 * The delete rule. Throws unless the branch is a rehearsal branch, or a staging
 * branch with the explicit opt-in. The default, primary and protected branches
 * are refused whatever they are called.
 */
export function assertDeletableBranch(branch: NeonBranch, options: { allowStaging?: boolean } = {}): void {
  const shown = JSON.stringify(branch.name);
  if (branch.default === true || branch.primary === true) {
    throw new Error(`Refusing to delete branch ${shown}: it is the project's default branch.`);
  }
  if (branch.protected === true) {
    throw new Error(`Refusing to delete branch ${shown}: it is a protected branch.`);
  }
  if (branch.name.startsWith(REHEARSAL_PREFIX)) return;
  if (branch.name.startsWith(STAGING_PREFIX)) {
    if (options.allowStaging === true) return;
    throw new Error(`Refusing to delete staging branch ${shown} without --allow-staging.`);
  }
  throw new Error(
    `Refusing to delete branch ${shown}: only branches named "${REHEARSAL_PREFIX}..." or "${STAGING_PREFIX}..." may be deleted by this tool.`,
  );
}

/** Parses the command line. Throws a plain message on bad input. */
export function parseArgs(argv: readonly string[], now: Date = new Date()): Command {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | true>();
  const BOOLEAN_FLAGS = new Set(["--no-endpoint", "--allow-staging"]);
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new Error("Unexpected value (not shown); every option starts with --.");
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flags.has(flag)) throw new Error(`${flag} was given twice.`);
    if (BOOLEAN_FLAGS.has(flag)) {
      if (eq !== -1) throw new Error(`${flag} takes no value.`);
      flags.set(flag, true);
      continue;
    }
    const next = eq === -1 ? rest[++i] : arg.slice(eq + 1);
    if (next === undefined || next === "" || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
    flags.set(flag, next);
  }
  const take = (flag: string): string | undefined => {
    const value = flags.get(flag);
    flags.delete(flag);
    return typeof value === "string" ? value : undefined;
  };
  const takeBoolean = (flag: string): boolean => {
    const value = flags.get(flag) === true;
    flags.delete(flag);
    return value;
  };
  const required = (flag: string): string => {
    const value = take(flag);
    if (value === undefined) throw new Error(`${command} needs ${flag}.`);
    return value;
  };
  const done = <T extends Command>(parsed: T): T => {
    if (flags.size > 0) throw new Error(`Unknown option ${[...flags.keys()][0]} for ${command}.`);
    return parsed;
  };

  switch (command) {
    case "list":
      return done({ command: "list" });
    case "create": {
      const parent = required("--parent");
      const name = assertCreatableName(required("--name"));
      const rawAt = take("--at");
      const at = rawAt === undefined ? null : assertRestoreTimestamp(rawAt, now);
      return done({ command: "create", parent, name, at, endpoint: !takeBoolean("--no-endpoint") });
    }
    case "wait": {
      const branch = required("--branch");
      const rawTimeout = take("--timeout-seconds");
      let timeoutSeconds = DEFAULT_WAIT_SECONDS;
      if (rawTimeout !== undefined) {
        timeoutSeconds = Number(rawTimeout);
        if (!/^\d+$/.test(rawTimeout) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
          throw new Error("--timeout-seconds must be a whole number between 1 and 3600.");
        }
      }
      return done({ command: "wait", branch, timeoutSeconds });
    }
    case "delete":
      return done({ command: "delete", branch: required("--branch"), allowStaging: takeBoolean("--allow-staging") });
    default:
      throw new Error(command === undefined ? "No command given." : "Unknown command (not shown).");
  }
}

export type NeonClientOptions = {
  apiKey: string | undefined;
  projectId: string | undefined;
  fetch?: FetchLike;
  /** Milliseconds between polls; tests pass 0. */
  pollMs?: number;
  now?: () => number;
};

export type NeonClient = ReturnType<typeof createNeonClient>;

export function createNeonClient(options: NeonClientOptions) {
  const apiKey = (options.apiKey ?? "").trim();
  const projectId = (options.projectId ?? "").trim();
  if (apiKey === "") throw new Error("NEON_API_KEY is not set in this shell.");
  if (!/^[a-z0-9-]{1,60}$/.test(projectId)) throw new Error("NEON_PROJECT_ID is not set in this shell, or is not a Neon project id.");
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const pollMs = options.pollMs ?? 2000;
  const now = options.now ?? Date.now;
  const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

  /** One API call. Errors carry the status and Neon's message, never the key. */
  async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    if (path.includes("/restore")) {
      throw new Error("Refusing to call a Neon restore endpoint: this tool only creates new branches.");
    }
    const response = await doFetch(`${NEON_API_BASE}/projects/${projectId}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      json = null;
    }
    if (!response.ok) {
      const message =
        json !== null && typeof json === "object" && typeof (json as { message?: unknown }).message === "string"
          ? (json as { message: string }).message
          : "no message";
      throw new Error(`Neon API ${method} failed with status ${response.status}: ${safeMessage(message, apiKey)}`);
    }
    return json as T;
  }

  async function listBranches(): Promise<NeonBranch[]> {
    const { branches } = await request<{ branches: NeonBranch[] }>("GET", "/branches");
    return branches;
  }

  /** Finds one branch by exact id or exact name. Throws when none or more than one match. */
  async function resolveBranch(idOrName: string): Promise<NeonBranch> {
    const branches = await listBranches();
    const matches = branches.filter((branch) => branch.id === idOrName || branch.name === idOrName);
    if (matches.length === 0) throw new Error(`No branch has the id or name ${JSON.stringify(idOrName)}.`);
    if (matches.length > 1) throw new Error(`More than one branch matches ${JSON.stringify(idOrName)}; use the branch id.`);
    return matches[0];
  }

  async function getBranch(branchId: string): Promise<NeonBranch> {
    const { branch } = await request<{ branch: NeonBranch }>("GET", `/branches/${branchId}`);
    return branch;
  }

  async function listEndpoints(branchId: string): Promise<NeonEndpoint[]> {
    const { endpoints } = await request<{ endpoints: NeonEndpoint[] }>("GET", `/branches/${branchId}/endpoints`);
    return endpoints;
  }

  /**
   * Creates a new branch from `parent` (optionally at a point in time). The
   * parent is never changed. Returns the branch and the operations to wait for.
   */
  async function createBranch(args: {
    parent: string;
    name: string;
    at?: string | null;
    endpoint?: boolean;
  }): Promise<{ branch: NeonBranch; operationIds: string[] }> {
    assertCreatableName(args.name);
    if (args.at) assertRestoreTimestamp(args.at, new Date(now()));
    const parent = await resolveBranch(args.parent);
    const existing = (await listBranches()).find((branch) => branch.name === args.name);
    if (existing) throw new Error(`A branch named ${JSON.stringify(args.name)} already exists.`);
    const body = {
      branch: {
        parent_id: parent.id,
        name: args.name,
        ...(args.at ? { parent_timestamp: args.at } : {}),
      },
      ...(args.endpoint === false ? {} : { endpoints: [{ type: "read_write" }] }),
    };
    const created = await request<{ branch: NeonBranch; operations?: NeonOperation[] }>("POST", "/branches", body);
    return { branch: created.branch, operationIds: (created.operations ?? []).map((operation) => operation.id) };
  }

  /** Polls until every operation finished and the branch (and its endpoint, if any) is ready. */
  async function waitUntilReady(
    branchId: string,
    waitOptions: { operationIds?: readonly string[]; timeoutSeconds?: number } = {},
  ): Promise<NeonBranch> {
    const deadline = now() + (waitOptions.timeoutSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;
    const pending = new Set(waitOptions.operationIds ?? []);
    for (;;) {
      for (const id of [...pending]) {
        const { operation } = await request<{ operation: NeonOperation }>("GET", `/operations/${id}`);
        if (operation.status === "finished" || operation.status === "skipped") pending.delete(id);
        else if (["failed", "error", "cancelled", "cancelling"].includes(operation.status)) {
          throw new Error(`Neon operation ${operation.action ?? "(unnamed)"} ended as ${operation.status}.`);
        }
      }
      if (pending.size === 0) {
        const branch = await getBranch(branchId);
        if (branch.current_state === "ready") {
          const endpoints = await listEndpoints(branchId);
          if (endpoints.every((endpoint) => endpoint.current_state === "active" || endpoint.current_state === "idle")) {
            return branch;
          }
        }
      }
      if (now() >= deadline) throw new Error("The branch did not become ready in time.");
      await sleep(pollMs);
    }
  }

  /**
   * The direct (unpooled) host of the branch's read-write endpoint, for a
   * script that must build a connection in memory. Never print the result.
   */
  async function branchEndpointHost(branchId: string): Promise<string> {
    const endpoint = (await listEndpoints(branchId)).find((candidate) => candidate.type === "read_write");
    if (!endpoint) throw new Error("The branch has no read-write endpoint.");
    return endpoint.host;
  }

  /** Deletes a branch after the delete rule accepted it. Returns the deleted branch. */
  async function deleteBranch(idOrName: string, deleteOptions: { allowStaging?: boolean } = {}): Promise<NeonBranch> {
    const branch = await resolveBranch(idOrName);
    assertDeletableBranch(branch, deleteOptions);
    await request<unknown>("DELETE", `/branches/${branch.id}`);
    return branch;
  }

  return { request, listBranches, resolveBranch, getBranch, createBranch, waitUntilReady, branchEndpointHost, deleteBranch };
}

/** One line, with the key and anything shaped like a connection string or database host removed. */
export function safeMessage(text: string, apiKey = ""): string {
  let line = text.split(/\r?\n/)[0] ?? "";
  if (apiKey !== "") line = line.split(apiKey).join("***");
  return line
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgresql://***")
    .replace(/[a-z0-9.-]+\.neon\.tech/gi, "(host not shown)")
    .slice(0, 300);
}

function describe(branch: NeonBranch): string {
  const parts = [branch.id, JSON.stringify(branch.name), `state=${branch.current_state ?? "unknown"}`];
  if (branch.default) parts.push("default");
  if (branch.protected) parts.push("protected");
  if (branch.parent_timestamp) parts.push(`at=${branch.parent_timestamp}`);
  if (branch.created_at) parts.push(`created=${branch.created_at}`);
  return parts.join(" ");
}

async function main(): Promise<number> {
  let parsed: Command;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Bad arguments.");
    console.error(USAGE);
    return 2;
  }

  try {
    const client = createNeonClient({ apiKey: process.env.NEON_API_KEY, projectId: process.env.NEON_PROJECT_ID });
    switch (parsed.command) {
      case "list":
        for (const branch of await client.listBranches()) console.log(describe(branch));
        return 0;
      case "create": {
        const { branch, operationIds } = await client.createBranch(parsed);
        console.log(`created ${describe(branch)}`);
        const ready = await client.waitUntilReady(branch.id, { operationIds });
        console.log(`ready ${describe(ready)}`);
        return 0;
      }
      case "wait": {
        const branch = await client.resolveBranch(parsed.branch);
        const ready = await client.waitUntilReady(branch.id, { timeoutSeconds: parsed.timeoutSeconds });
        console.log(`ready ${describe(ready)}`);
        return 0;
      }
      case "delete": {
        const branch = await client.deleteBranch(parsed.branch, { allowStaging: parsed.allowStaging });
        console.log(`deleted ${branch.id} ${JSON.stringify(branch.name)}`);
        return 0;
      }
    }
  } catch (error) {
    console.error(safeMessage(error instanceof Error ? error.message : "The Neon API call failed.", process.env.NEON_API_KEY ?? ""));
    return 1;
  }
}

if (/neon-branch\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().then(
    (code) => process.exit(code),
    () => {
      console.error("neon-branch failed.");
      process.exit(1);
    },
  );
}
