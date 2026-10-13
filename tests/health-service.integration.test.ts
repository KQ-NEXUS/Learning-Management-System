/**
 * Real-Postgres proof for the health probe (plan 15-06; NFR-01, D-18,
 * T-15-06-02).
 *
 * The route test mocks the service, so it cannot prove that `SELECT 1` really
 * runs through a Prisma client against Postgres, or that the 2 second bound
 * holds when the database never answers. This file binds `createHealthService`
 * to a throwaway Testcontainers database (never the `.env` database) for the
 * healthy case, and to fake clients for the rejecting and hanging cases.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED — never a silent pass,
 * never a weakened mock.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createHealthService, type HealthClient } from "@/server/services/health-service";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("health service pingDatabase", () => {
  it("returns true when SELECT 1 completes against a real Postgres", async () => {
    const service = createHealthService({ client: testDb.prisma });

    await expect(service.pingDatabase(2000)).resolves.toBe(true);
  });

  it("returns false (and does not throw) when the query rejects", async () => {
    const rejecting: HealthClient = {
      $queryRaw: () => Promise.reject(new Error("connection refused")),
    };
    const service = createHealthService({ client: rejecting });

    await expect(service.pingDatabase(2000)).resolves.toBe(false);
  });

  it("returns false (and does not throw) when the client throws synchronously", async () => {
    const throwing: HealthClient = {
      $queryRaw: () => {
        throw new Error("client not initialised");
      },
    };
    const service = createHealthService({ client: throwing });

    await expect(service.pingDatabase(2000)).resolves.toBe(false);
  });

  it("returns false once the bound elapses when the query never resolves", async () => {
    const hanging: HealthClient = {
      $queryRaw: () => new Promise<never>(() => {}),
    };
    const service = createHealthService({ client: hanging });

    const started = Date.now();
    const result = await service.pingDatabase(200);
    const elapsed = Date.now() - started;

    expect(result).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2000);
  });

  it("returns false within the 2 second bound when a real query outlasts it", async () => {
    const slow: HealthClient = {
      $queryRaw: () => testDb.prisma.$queryRaw`SELECT pg_sleep(3)`,
    };
    const service = createHealthService({ client: slow });

    const started = Date.now();
    const result = await service.pingDatabase(2000);
    const elapsed = Date.now() - started;

    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(2900);
  }, 10_000);
});
