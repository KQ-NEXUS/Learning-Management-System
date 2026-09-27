-- F-14b: per-device sign-in throttle (replaces per-account lockout).
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "email" TEXT,
    "failures" INTEGER NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "LoginThrottle_email_idx" ON "LoginThrottle"("email");
