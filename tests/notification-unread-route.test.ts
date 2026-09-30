/**
 * Unit tests for `GET /api/notifications/unread` (D-22, T-13-22): 401 with
 * no session, 200 with the service's count otherwise, and
 * `Cache-Control: private, no-store` on both responses so no shared cache
 * or CDN can ever serve one visitor's unread count to another.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/current-actor", () => ({
  getCurrentActor: vi.fn(),
}));

vi.mock("@/server/services/notification-service", () => ({
  notificationService: { unreadCount: vi.fn() },
}));

import { getCurrentActor } from "@/server/auth/current-actor";
import { notificationService } from "@/server/services/notification-service";
import { GET } from "@/app/api/notifications/unread/route";

const mockedGetCurrentActor = vi.mocked(getCurrentActor);
const mockedUnreadCount = vi.mocked(notificationService.unreadCount);

describe("GET /api/notifications/unread", () => {
  it("returns 401 with unread 0 and no-store when there is no session", async () => {
    mockedGetCurrentActor.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ unread: 0 });
    expect(mockedUnreadCount).not.toHaveBeenCalled();
  });

  it("returns 200 with the service's count and no-store when signed in", async () => {
    mockedGetCurrentActor.mockResolvedValueOnce({ userId: "user-1" });
    mockedUnreadCount.mockResolvedValueOnce(3);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ unread: 3 });
    expect(mockedUnreadCount).toHaveBeenCalledWith({ userId: "user-1" });
  });
});
