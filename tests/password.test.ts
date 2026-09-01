import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

const TIMEOUT = 30_000;

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  }, TIMEOUT);

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  }, TIMEOUT);

  it("produces a different hash each time for the same password", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  }, TIMEOUT);

  it("records its parameters in the stored format", async () => {
    const hash = await hashPassword("x");
    const [scheme, n, r, p] = hash.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(131072);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  }, TIMEOUT);

  it("fails closed on a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$2$3")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$8$1$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt$x$y$z$aa$bb")).toBe(false);
  }, TIMEOUT);

  it("rejects an empty password at hash time", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  }, TIMEOUT);
});
