/**
 * Pilot-load seeding (Phase 15, plan 15-14; D-02, NFR-02, NFR-03).
 *
 *   npx tsx scripts/load/seed-load.ts [--learners 150] [--staff 10]
 *        [--target local|staging] [--volume] [--tokens-out perf/results/tokens.json]
 *        [--pending-order]
 *
 * Creates the accounts the k6 pilot load signs in as: 150 learners and 10 staff
 * (defaults) with active enrolments in the seeded pilot cohorts, staff holding
 * the Administrator role (every staff view the load visits), and one Session row
 * per account whose `sessionToken` is hashToken(raw) exactly as the sign-in
 * action stores it. The raw tokens, the one random password and the ids the
 * scripts need go ONLY to the gitignored `perf/results` folder; the terminal
 * gets counts and never a token or a password.
 *
 * Flags:
 *   --volume          Also adds 5,000 orders (with payment attempts) and 2,000
 *                     support tickets spread across the pilot cohorts, so the
 *                     unbounded-list risks are measured with realistic data.
 *   --volume-scale N  (test option) multiplies those two counts, e.g. 0.01.
 *   --pending-order   Creates one PENDING Paystack order for a fresh learner,
 *                     with its seat hold and payment attempt, writes it to
 *                     perf/results/pending-order.json and prints the reference.
 *                     perf/webhook-replay.js settles it with a signed event.
 *   --cohorts a,b,c   Cohort codes to enrol into (default: the three seeded
 *                     pilot cohorts).
 *
 * Safety (P1, T-15-14-01/02/03):
 *   - assertSafeDatabaseUrl runs FIRST, before Prisma is imported. A shared
 *     Neon URL, or any non-local host without the explicit staging opt-in,
 *     exits non-zero without a connection being opened.
 *   - One random password is generated per run and hashed ONCE (scrypt is slow);
 *     the repository's default seed password is never used.
 *   - Idempotent: accounts, enrolments, orders and tickets are keyed on stable
 *     natural keys, so a re-run updates the same rows and issues fresh sessions.
 *
 * Capacity: the seeded pilot cohorts hold 25 or 40 seats, far short of 150
 * learners. Each used cohort's capacity is raised to at least its live seat
 * count and seatsTaken is recomputed from the real rows (the same rule the
 * development seed uses), so the seat CHECK and the capacity integrity check
 * stay satisfied.
 *
 * This module exports `seedLoad` for the integration test and only runs the
 * command line when it is started directly.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/server/auth/password";
import { hashToken } from "../../src/server/auth/token-hash";
import { assertSafeDatabaseUrl, type DatabaseTarget } from "../ops/db-target-guard";

export const DEFAULT_PILOT_COHORT_CODES = ["SLP-2026-01", "SLP-2026-03", "FCM-2026-02"] as const;
export const DEFAULT_TOKENS_OUT = path.join("perf", "results", "tokens.json");
export const DEFAULT_PENDING_ORDER_OUT = path.join("perf", "results", "pending-order.json");

export const VOLUME_ORDERS = 5_000;
export const VOLUME_TICKETS = 2_000;

const SESSION_TTL_MS = 7 * 86_400_000;
const LOAD_EMAIL_DOMAIN = "load.test";
const STAFF_ROLE = "Administrator";
const BATCH = 1_000;

export type SeedLoadOptions = {
  learners: number;
  staff: number;
  volume: boolean;
  /** Multiplier on the 5,000 order / 2,000 ticket volume. 1 in real runs. */
  volumeScale: number;
  pendingOrder: boolean;
  cohortCodes: readonly string[];
  now: Date;
};

export type LearnerContext = { enrolmentId: string; lessonIds: string[] };

/** What perf/*.js reads. Raw secrets: this object is only ever written under perf/results. */
export type LoadTokensFile = {
  generatedAt: string;
  password: string;
  learners: string[];
  staff: string[];
  learnerEmails: string[];
  staffEmails: string[];
  learnerContext: LearnerContext[];
  ids: { cohortId: string | null; assessmentId: string | null };
};

export type PendingOrderFile = {
  orderId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  eventId: number;
};

export type SeedLoadResult = {
  learners: number;
  staff: number;
  sessions: number;
  enrolments: number;
  cohorts: { code: string; capacity: number; seatsTaken: number }[];
  tokens: LoadTokensFile;
  volume: { orders: number; tickets: number } | null;
  pendingOrder: PendingOrderFile | null;
};

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

export function learnerEmail(index: number): string {
  return `load-learner-${pad(index, 3)}@${LOAD_EMAIL_DOMAIN}`;
}

export function staffEmail(index: number): string {
  return `load-staff-${pad(index, 2)}@${LOAD_EMAIL_DOMAIN}`;
}

function newRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function newPassword(): string {
  return `Ld-${randomBytes(18).toString("base64url")}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Db = PrismaClient;

type CohortRow = { id: string; code: string; capacity: number; priceNgnMinor: number | null; priceMinor: number };

async function findCohorts(db: Db, codes: readonly string[]): Promise<CohortRow[]> {
  const rows = await db.cohort.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true, code: true, capacity: true, priceNgnMinor: true, priceMinor: true },
  });
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const missing = codes.filter((code) => !byCode.has(code));
  if (missing.length > 0) {
    throw new Error(
      `Pilot cohort(s) not found: ${missing.join(", ")}. Run "npx prisma db seed" against the local database first.`,
    );
  }
  return codes.map((code) => byCode.get(code)!);
}

async function upsertLoadUser(
  db: Db,
  args: { email: string; name: string; passwordHash: string; isStaff: boolean; now: Date },
): Promise<string> {
  const user = await db.user.upsert({
    where: { email: args.email },
    update: {
      name: args.name,
      passwordHash: args.passwordHash,
      status: "ACTIVE",
      emailVerified: args.now,
      isStaff: args.isStaff,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
      email: args.email,
      name: args.name,
      passwordHash: args.passwordHash,
      status: "ACTIVE",
      emailVerified: args.now,
      isStaff: args.isStaff,
    },
    select: { id: true },
  });
  return user.id;
}

async function ensureGlobalRole(db: Db, userId: string, roleId: string): Promise<void> {
  const existing = await db.assignment.findFirst({
    where: { userId, roleId, scopeType: "GLOBAL", active: true },
    select: { id: true },
  });
  if (existing) return;
  await db.assignment.create({
    data: { userId, roleId, scopeType: "GLOBAL", scopeId: null, active: true, reason: "Load test account" },
  });
}

/** Replaces any earlier load sessions for the user with one fresh session; returns the raw token. */
async function issueSession(db: Db, userId: string, now: Date): Promise<string> {
  const raw = newRawToken();
  await db.session.deleteMany({ where: { userId } });
  await db.session.create({
    data: { userId, sessionToken: hashToken(raw), expires: new Date(now.getTime() + SESSION_TTL_MS) },
  });
  return raw;
}

async function ensureActiveEnrolment(db: Db, userId: string, cohortId: string, now: Date): Promise<string> {
  const existing = await db.enrolment.findFirst({
    where: { userId, cohortId, status: "ACTIVE" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.enrolment.create({
    data: { userId, cohortId, status: "ACTIVE", activatedAt: now, reason: "Load test enrolment" },
    select: { id: true },
  });
  return created.id;
}

/** Raises capacity to fit the live seats and recomputes seatsTaken from the rows. */
async function reconcileSeats(db: Db, cohorts: readonly CohortRow[]): Promise<SeedLoadResult["cohorts"]> {
  const out: SeedLoadResult["cohorts"] = [];
  for (const cohort of cohorts) {
    const seatHolders = await db.enrolment.count({
      where: {
        cohortId: cohort.id,
        OR: [{ status: "ACTIVE" }, { status: "PENDING_PAYMENT", holdExpiresAt: { not: null } }],
      },
    });
    const capacity = Math.max(cohort.capacity, seatHolders);
    await db.cohort.update({ where: { id: cohort.id }, data: { capacity, seatsTaken: seatHolders } });
    out.push({ code: cohort.code, capacity, seatsTaken: seatHolders });
  }
  return out;
}

async function lessonIdsForCohort(db: Db, cohortId: string): Promise<string[]> {
  const links = await db.cohortCourse.findMany({
    where: { cohortId },
    orderBy: { position: "asc" },
    select: { courseId: true },
  });
  const ids: string[] = [];
  for (const { courseId } of links) {
    const lessons = await db.lesson.findMany({
      where: { module: { courseId }, withdrawnAt: null, type: "TEXT" },
      orderBy: [{ module: { position: "asc" } }, { position: "asc" }],
      select: { id: true },
      take: 2,
    });
    ids.push(...lessons.map((lesson) => lesson.id));
    if (ids.length >= 2) break;
  }
  return ids.slice(0, 2);
}

async function findGradingTarget(
  db: Db,
  cohorts: readonly CohortRow[],
): Promise<{ cohortId: string | null; assessmentId: string | null }> {
  for (const cohort of cohorts) {
    const links = await db.cohortCourse.findMany({ where: { cohortId: cohort.id }, select: { courseId: true } });
    if (links.length === 0) continue;
    const assessment = await db.assessment.findFirst({
      where: { courseId: { in: links.map((link) => link.courseId) }, type: "ASSIGNMENT" },
      select: { id: true },
    });
    if (assessment) return { cohortId: cohort.id, assessmentId: assessment.id };
  }
  return { cohortId: cohorts[0]?.id ?? null, assessmentId: null };
}

const ORDER_MIX = ["PAID", "PAID", "PAID", "PAID", "PAID", "PAID", "PAID", "PENDING", "FAILED", "CANCELLED"] as const;
const TICKET_CATEGORIES = [
  ["ACCOUNT_ACCESS", "ACCOUNTS"],
  ["PAYMENT_ORDER", "FINANCE"],
  ["COURSE_CONTENT", "LEARNING_ASSESSMENT"],
  ["ASSESSMENT_RESULT", "LEARNING_ASSESSMENT"],
  ["CERTIFICATE", "GENERAL_SUPPORT"],
  ["TECHNICAL_PROBLEM", "TECHNICAL"],
  ["OTHER", "GENERAL_SUPPORT"],
] as const;
const TICKET_STATUSES = ["NEW", "OPEN", "OPEN", "ASSIGNED", "ESCALATED", "RESOLVED", "CLOSED", "CLOSED"] as const;
const TICKET_PRIORITIES = ["NORMAL", "NORMAL", "LOW", "HIGH", "URGENT"] as const;

function spreadDate(now: Date, index: number, days: number): Date {
  // Deterministic, spread over the last `days` days.
  return new Date(now.getTime() - ((index * 7_919) % (days * 86_400)) * 1_000);
}

async function seedVolume(
  db: Db,
  args: { learnerIds: string[]; cohorts: readonly CohortRow[]; scale: number; now: Date },
): Promise<{ orders: number; tickets: number }> {
  const orderCount = Math.round(VOLUME_ORDERS * args.scale);
  const ticketCount = Math.round(VOLUME_TICKETS * args.scale);
  const { learnerIds, cohorts, now } = args;
  if (learnerIds.length === 0 || cohorts.length === 0) return { orders: 0, tickets: 0 };

  const orders: Prisma.OrderCreateManyInput[] = [];
  const attempts: Prisma.PaymentAttemptCreateManyInput[] = [];
  for (let i = 1; i <= orderCount; i += 1) {
    const cohort = cohorts[i % cohorts.length];
    const status = ORDER_MIX[i % ORDER_MIX.length];
    const amountMinor = cohort.priceNgnMinor ?? (cohort.priceMinor > 0 ? cohort.priceMinor : 1_000_000);
    const createdAt = spreadDate(now, i, 90);
    const id = `lord${pad(i, 6)}`;
    orders.push({
      id,
      reference: `LOAD-ORD-${pad(i, 6)}`,
      userId: learnerIds[i % learnerIds.length],
      cohortId: cohort.id,
      amountMinor,
      baseAmountMinor: amountMinor,
      currency: "NGN",
      status,
      selectedProvider: "PAYSTACK",
      idempotencyKey: `load-order-key-${pad(i, 6)}`,
      createdAt,
      paidAt: status === "PAID" ? createdAt : null,
    });
    attempts.push({
      id: `lpat${pad(i, 6)}`,
      orderId: id,
      provider: "PAYSTACK",
      providerRef: `LOAD-REF-${pad(i, 6)}`,
      providerIntentId: `LOAD-REF-${pad(i, 6)}`,
      amountMinor,
      currency: "NGN",
      status: status === "PAID" ? "SUCCEEDED" : status === "PENDING" ? "PENDING" : status === "FAILED" ? "FAILED" : "CANCELLED",
      idempotencyKey: `load-attempt-key-${pad(i, 6)}`,
      initiatedAt: createdAt,
      confirmedAt: status === "PAID" ? createdAt : null,
      failedAt: status === "FAILED" ? createdAt : null,
    });
  }
  for (const part of chunk(orders, BATCH)) await db.order.createMany({ data: part, skipDuplicates: true });
  for (const part of chunk(attempts, BATCH)) await db.paymentAttempt.createMany({ data: part, skipDuplicates: true });

  const tickets: Prisma.TicketCreateManyInput[] = [];
  const messages: Prisma.TicketMessageCreateManyInput[] = [];
  for (let i = 1; i <= ticketCount; i += 1) {
    const cohort = cohorts[i % cohorts.length];
    const [category, queue] = TICKET_CATEGORIES[i % TICKET_CATEGORIES.length];
    const createdAt = spreadDate(now, i, 60);
    const userId = learnerIds[(i * 3) % learnerIds.length];
    const id = `ltkt${pad(i, 6)}`;
    tickets.push({
      id,
      reference: `LOAD-TKT-${pad(i, 6)}`,
      userId,
      category,
      queue,
      subject: `Load test enquiry ${i}`,
      priority: TICKET_PRIORITIES[i % TICKET_PRIORITIES.length],
      status: TICKET_STATUSES[i % TICKET_STATUSES.length],
      cohortId: cohort.id,
      createdAt,
    });
    messages.push({
      id: `lmsg${pad(i, 6)}`,
      ticketId: id,
      authorId: userId,
      kind: "INITIAL",
      visibility: "PUBLIC",
      body: `Load test message for enquiry ${i}.`,
      createdAt,
    });
  }
  for (const part of chunk(tickets, BATCH)) await db.ticket.createMany({ data: part, skipDuplicates: true });
  for (const part of chunk(messages, BATCH)) await db.ticketMessage.createMany({ data: part, skipDuplicates: true });

  return { orders: orderCount, tickets: ticketCount };
}

async function seedPendingOrder(db: Db, cohort: CohortRow, now: Date): Promise<PendingOrderFile> {
  const suffix = randomBytes(5).toString("hex");
  const reference = `LOAD-PENDING-${suffix}`;
  const user = await db.user.create({
    data: {
      email: `load-pending-${suffix}@${LOAD_EMAIL_DOMAIN}`,
      name: "Load pending payer",
      passwordHash: null,
      status: "ACTIVE",
      emailVerified: now,
    },
    select: { id: true },
  });
  const amountMinor = cohort.priceNgnMinor ?? (cohort.priceMinor > 0 ? cohort.priceMinor : 1_000_000);

  // A pending payment holds a seat until it settles (the seat-held predicate
  // is a PENDING_PAYMENT enrolment with holdExpiresAt set). Make room first.
  const live = await db.enrolment.count({
    where: {
      cohortId: cohort.id,
      OR: [{ status: "ACTIVE" }, { status: "PENDING_PAYMENT", holdExpiresAt: { not: null } }],
    },
  });
  await db.cohort.update({
    where: { id: cohort.id },
    data: { capacity: Math.max(cohort.capacity, live + 1), seatsTaken: live + 1 },
  });

  const order = await db.order.create({
    data: {
      reference,
      userId: user.id,
      cohortId: cohort.id,
      amountMinor,
      baseAmountMinor: amountMinor,
      currency: "NGN",
      status: "PENDING",
      selectedProvider: "PAYSTACK",
      idempotencyKey: `load-pending-order-${suffix}`,
    },
    select: { id: true },
  });
  await db.paymentAttempt.create({
    data: {
      orderId: order.id,
      provider: "PAYSTACK",
      providerIntentId: reference,
      amountMinor,
      currency: "NGN",
      // After initiation a Paystack attempt is PROCESSING; PENDING -> SUCCEEDED is
      // an illegal payment transition and would settle as an exception.
      status: "PROCESSING",
      idempotencyKey: `load-pending-attempt-${suffix}`,
    },
  });
  await db.enrolment.create({
    data: {
      userId: user.id,
      cohortId: cohort.id,
      orderId: order.id,
      status: "PENDING_PAYMENT",
      holdExpiresAt: new Date(now.getTime() + 24 * 3_600_000),
      reason: "Load test pending payment",
    },
  });

  // Paystack event ids are numbers; a random one per order keeps reruns apart.
  const eventId = 9_000_000_000 + Math.floor(Math.random() * 999_999_999);
  return { orderId: order.id, reference, amountMinor, currency: "NGN", eventId };
}

export async function seedLoad(db: Db, options: SeedLoadOptions): Promise<SeedLoadResult> {
  const { now } = options;
  const cohorts = await findCohorts(db, options.cohortCodes);
  const staffRole = await db.role.findUnique({ where: { name: STAFF_ROLE }, select: { id: true } });
  if (!staffRole && options.staff > 0) {
    throw new Error(`Role "${STAFF_ROLE}" not found. Run "npx prisma db seed" against the local database first.`);
  }

  // One password, one scrypt hash, shared by every load account (never the default seed password).
  const password = newPassword();
  const passwordHash = await hashPassword(password);

  const learnerIds: string[] = [];
  const learnerTokens: string[] = [];
  const learnerEmails: string[] = [];
  const learnerContext: LearnerContext[] = [];
  const lessonCache = new Map<string, string[]>();
  let enrolments = 0;

  for (let i = 1; i <= options.learners; i += 1) {
    const email = learnerEmail(i);
    const userId = await upsertLoadUser(db, { email, name: `Load Learner ${pad(i, 3)}`, passwordHash, isStaff: false, now });
    const cohort = cohorts[(i - 1) % cohorts.length];
    const enrolmentId = await ensureActiveEnrolment(db, userId, cohort.id, now);
    enrolments += 1;
    if (!lessonCache.has(cohort.id)) lessonCache.set(cohort.id, await lessonIdsForCohort(db, cohort.id));
    learnerIds.push(userId);
    learnerEmails.push(email);
    learnerTokens.push(await issueSession(db, userId, now));
    learnerContext.push({ enrolmentId, lessonIds: lessonCache.get(cohort.id)! });
  }

  const staffTokens: string[] = [];
  const staffEmails: string[] = [];
  for (let i = 1; i <= options.staff; i += 1) {
    const email = staffEmail(i);
    const userId = await upsertLoadUser(db, { email, name: `Load Staff ${pad(i, 2)}`, passwordHash, isStaff: true, now });
    await ensureGlobalRole(db, userId, staffRole!.id);
    staffEmails.push(email);
    staffTokens.push(await issueSession(db, userId, now));
  }

  const seats = await reconcileSeats(db, cohorts);
  const ids = await findGradingTarget(db, cohorts);

  const volume = options.volume
    ? await seedVolume(db, { learnerIds, cohorts, scale: options.volumeScale, now })
    : null;

  // Pending order goes last: it re-reads the live seat count itself.
  const pendingOrder = options.pendingOrder ? await seedPendingOrder(db, cohorts[cohorts.length - 1], now) : null;

  return {
    learners: learnerTokens.length,
    staff: staffTokens.length,
    sessions: learnerTokens.length + staffTokens.length,
    enrolments,
    cohorts: seats,
    tokens: {
      generatedAt: now.toISOString(),
      password,
      learners: learnerTokens,
      staff: staffTokens,
      learnerEmails,
      staffEmails,
      learnerContext,
      ids,
    },
    volume,
    pendingOrder,
  };
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

type CliOptions = SeedLoadOptions & { target: DatabaseTarget; tokensOut: string };

const USAGE =
  "Usage: npx tsx scripts/load/seed-load.ts [--learners N] [--staff N] [--target local|staging] [--volume] [--volume-scale N] [--pending-order] [--cohorts a,b,c] [--tokens-out file]";

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    learners: 150,
    staff: 10,
    volume: false,
    volumeScale: 1,
    pendingOrder: false,
    cohortCodes: DEFAULT_PILOT_COHORT_CODES,
    now: new Date(),
    target: "local",
    tokensOut: DEFAULT_TOKENS_OUT,
  };
  const count = (flag: string, raw: string, min: number): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw new Error(`${flag} must be a whole number of at least ${min}.`);
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const value = (): string => {
      const next = inline ?? argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
      return next;
    };
    switch (flag) {
      case "--learners":
        options.learners = count(flag, value(), 0);
        break;
      case "--staff":
        options.staff = count(flag, value(), 0);
        break;
      case "--target": {
        const target = value();
        if (target !== "local" && target !== "staging") throw new Error('--target must be "local" or "staging".');
        options.target = target;
        break;
      }
      case "--volume":
        options.volume = true;
        break;
      case "--volume-scale": {
        const scale = Number(value());
        if (!Number.isFinite(scale) || scale <= 0) throw new Error("--volume-scale must be a positive number.");
        options.volumeScale = scale;
        break;
      }
      case "--pending-order":
        options.pendingOrder = true;
        break;
      case "--cohorts": {
        const codes = value().split(",").map((code) => code.trim()).filter(Boolean);
        if (codes.length === 0) throw new Error("--cohorts needs at least one cohort code.");
        options.cohortCodes = codes;
        break;
      }
      case "--tokens-out":
        options.tokensOut = value();
        break;
      default:
        throw new Error(`Unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  return options;
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Bad arguments.");
    console.error(USAGE);
    process.exit(2);
  }

  // P1: the guard runs BEFORE Prisma is imported, so a shell carrying the
  // shared Neon URL never opens a connection.
  let host: string;
  try {
    host = assertSafeDatabaseUrl(process.env.DATABASE_URL, { target: options.target }).host;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Refusing to run: the database target check failed.");
    process.exit(1);
  }

  const { PrismaClient: PrismaClientCtor } = await import("@prisma/client");
  const db = new PrismaClientCtor();
  try {
    const result = await seedLoad(db, options);
    if (options.learners + options.staff > 0) writeJson(options.tokensOut, result.tokens);
    if (result.pendingOrder) writeJson(DEFAULT_PENDING_ORDER_OUT, result.pendingOrder);
    console.log(
      `seed-load on ${host}: ${result.learners} learners, ${result.staff} staff, ${result.sessions} sessions, ${result.enrolments} enrolments.`,
    );
    for (const cohort of result.cohorts) {
      console.log(`  cohort ${cohort.code}: ${cohort.seatsTaken} seats of ${cohort.capacity}`);
    }
    if (result.volume) console.log(`  volume: ${result.volume.orders} orders, ${result.volume.tickets} tickets`);
    if (result.pendingOrder) {
      console.log(`  pending order: ${result.pendingOrder.reference} (${result.pendingOrder.amountMinor} ${result.pendingOrder.currency}) -> ${DEFAULT_PENDING_ORDER_OUT}`);
    }
    if (options.learners + options.staff > 0) console.log(`  tokens file: ${options.tokensOut} (ignored by git)`);
  } finally {
    await db.$disconnect();
  }
}

const invokedDirectly = /seed-load\.[cm]?[jt]s$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message.split("\n")[0] : "seed-load failed.");
    process.exit(1);
  });
}
