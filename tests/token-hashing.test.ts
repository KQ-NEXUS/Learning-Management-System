import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));
vi.mock("@/server/db", () => ({
  prisma: { session: { findUnique: db.findUnique, updateMany: db.updateMany } },
}));

import { hashToken } from "@/server/auth/token-hash";
import { getActorBySessionToken } from "@/server/services/session-service";
import { signOut } from "@/server/services/auth-service";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

beforeEach(() => vi.clearAllMocks());

describe("F-14a — bearer tokens are stored and looked up as SHA-256 hashes", () => {
  it("hashToken is the hex SHA-256 of the token (the same function the migration applies in SQL)", () => {
    expect(hashToken("abc")).toBe(sha256("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a session cookie is resolved by its hash, never by the raw value", async () => {
    db.findUnique.mockResolvedValue({
      expires: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { id: "u1", status: "ACTIVE", isStaff: false },
    });
    await expect(getActorBySessionToken("raw-cookie")).resolves.toEqual({ userId: "u1", isStaff: false });
    expect(db.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionToken: sha256("raw-cookie") } }));
  });

  it("sign-out revokes the session by its hash", async () => {
    db.updateMany.mockResolvedValue({ count: 1 });
    await signOut("raw-cookie");
    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionToken: sha256("raw-cookie"), revokedAt: null } }),
    );
  });
});
