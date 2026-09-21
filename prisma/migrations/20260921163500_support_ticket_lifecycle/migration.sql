-- Closed support vocabulary used by the ticket aggregate.
CREATE TYPE "TicketCategory" AS ENUM (
  'ACCOUNT_ACCESS',
  'PAYMENT_ORDER',
  'COURSE_CONTENT',
  'ASSESSMENT_RESULT',
  'CERTIFICATE',
  'TECHNICAL_PROBLEM',
  'OTHER'
);

CREATE TYPE "TicketQueue" AS ENUM (
  'GENERAL_SUPPORT',
  'ACCOUNTS',
  'FINANCE',
  'LEARNING_ASSESSMENT',
  'TECHNICAL'
);

CREATE TYPE "TicketMessageKind" AS ENUM ('INITIAL', 'REPLY', 'INTERNAL_NOTE');

CREATE TYPE "TicketEventType" AS ENUM (
  'CREATED',
  'CLAIMED',
  'ASSIGNED',
  'REASSIGNED',
  'PRIORITY_CHANGED',
  'ESCALATED',
  'ESCALATION_ACCEPTED',
  'RESOLVED',
  'REOPENED',
  'LEARNER_CLOSED',
  'AUTO_CLOSED'
);

-- Legacy free-form categories cannot be converted without an explicit mapping.
-- Abort before changing any ticket row if an unexpected value exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Ticket"
    WHERE "category" NOT IN (
      'ACCOUNT_ACCESS',
      'PAYMENT_ORDER',
      'COURSE_CONTENT',
      'ASSESSMENT_RESULT',
      'CERTIFICATE',
      'TECHNICAL_PROBLEM',
      'OTHER'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported legacy Ticket.category value; map it explicitly before applying support_ticket_lifecycle';
  END IF;
END $$;

ALTER TABLE "Ticket"
  ADD COLUMN "certificateId" TEXT,
  ADD COLUMN "queue" "TicketQueue" NOT NULL DEFAULT 'GENERAL_SUPPORT',
  ADD COLUMN "submissionId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Ticket"
  ALTER COLUMN "category" TYPE "TicketCategory"
  USING "category"::"TicketCategory";

-- Derive message kind deterministically for any legacy conversation.
ALTER TABLE "TicketMessage" ADD COLUMN "kind" "TicketMessageKind";

WITH ranked_public_messages AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "ticketId"
      ORDER BY "createdAt", "id"
    ) AS public_position
  FROM "TicketMessage"
  WHERE "visibility" = 'PUBLIC'
)
UPDATE "TicketMessage" AS message
SET "kind" = CASE
  WHEN message."visibility" = 'INTERNAL' THEN 'INTERNAL_NOTE'::"TicketMessageKind"
  WHEN ranked.public_position = 1 THEN 'INITIAL'::"TicketMessageKind"
  ELSE 'REPLY'::"TicketMessageKind"
END
FROM ranked_public_messages AS ranked
WHERE ranked."id" = message."id";

UPDATE "TicketMessage"
SET "kind" = 'INTERNAL_NOTE'::"TicketMessageKind"
WHERE "kind" IS NULL AND "visibility" = 'INTERNAL';

ALTER TABLE "TicketMessage" ALTER COLUMN "kind" SET NOT NULL;

-- Attachment visibility must always derive from a message. Stop before the
-- nullable relation is tightened if an orphan needs a human data decision.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TicketAttachment" WHERE "messageId" IS NULL) THEN
    RAISE EXCEPTION 'Legacy TicketAttachment rows without messageId require an explicit preservation mapping';
  END IF;
END $$;

ALTER TABLE "TicketAttachment"
  ADD COLUMN "uploadDetail" JSONB,
  ADD COLUMN "uploadedAt" TIMESTAMP(3),
  ADD COLUMN "uploadedById" TEXT;

UPDATE "TicketAttachment" AS attachment
SET
  "uploadedAt" = attachment."createdAt",
  "uploadedById" = message."authorId"
FROM "TicketMessage" AS message
WHERE message."id" = attachment."messageId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TicketAttachment"
    WHERE "uploadedAt" IS NULL OR "uploadedById" IS NULL
  ) THEN
    RAISE EXCEPTION 'TicketAttachment uploader attribution could not be derived from its message';
  END IF;
END $$;

ALTER TABLE "TicketAttachment"
  ALTER COLUMN "messageId" SET NOT NULL,
  ALTER COLUMN "sizeBytes" SET DATA TYPE BIGINT,
  ALTER COLUMN "uploadedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "uploadedAt" SET NOT NULL,
  ALTER COLUMN "uploadedById" SET NOT NULL;

CREATE TABLE "TicketEvent" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "actorId" TEXT,
  "actorType" TEXT NOT NULL DEFAULT 'USER',
  "type" "TicketEventType" NOT NULL,
  "reason" TEXT,
  "correlationId" TEXT,
  "statusBefore" "TicketStatus",
  "statusAfter" "TicketStatus",
  "priorityBefore" "TicketPriority",
  "priorityAfter" "TicketPriority",
  "queueBefore" "TicketQueue",
  "queueAfter" "TicketQueue",
  "assigneeBeforeId" TEXT,
  "assigneeAfterId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- Existing requester attribution is a durable fact, not an invented actor.
INSERT INTO "TicketEvent" (
  "id",
  "ticketId",
  "actorId",
  "actorType",
  "type",
  "statusAfter",
  "priorityAfter",
  "queueAfter",
  "assigneeAfterId",
  "createdAt"
)
SELECT
  'legacy-ticket-created-' || "id",
  "id",
  "userId",
  'USER',
  'CREATED'::"TicketEventType",
  "status",
  "priority",
  "queue",
  "assigneeId",
  "createdAt"
FROM "Ticket";

DROP INDEX "Ticket_assigneeId_status_idx";
DROP INDEX "Ticket_status_priority_idx";
DROP INDEX "Ticket_userId_idx";
DROP INDEX "TicketAttachment_ticketId_idx";

CREATE INDEX "TicketEvent_ticketId_createdAt_id_idx"
  ON "TicketEvent"("ticketId", "createdAt", "id");
CREATE INDEX "TicketEvent_actorId_createdAt_idx"
  ON "TicketEvent"("actorId", "createdAt");
CREATE INDEX "TicketEvent_type_createdAt_idx"
  ON "TicketEvent"("type", "createdAt");
CREATE INDEX "Ticket_queue_status_priority_updatedAt_idx"
  ON "Ticket"("queue", "status", "priority", "updatedAt");
CREATE INDEX "Ticket_assigneeId_status_updatedAt_idx"
  ON "Ticket"("assigneeId", "status", "updatedAt");
CREATE INDEX "Ticket_userId_createdAt_idx"
  ON "Ticket"("userId", "createdAt");
CREATE INDEX "TicketAttachment_ticketId_uploadStatus_idx"
  ON "TicketAttachment"("ticketId", "uploadStatus");
CREATE INDEX "TicketAttachment_messageId_uploadStatus_idx"
  ON "TicketAttachment"("messageId", "uploadStatus");
CREATE INDEX "TicketAttachment_uploadedById_uploadedAt_idx"
  ON "TicketAttachment"("uploadedById", "uploadedAt");

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "Submission"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Ticket_certificateId_fkey"
  FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Ticket_at_most_one_context_check"
  CHECK (num_nonnulls("cohortId", "courseId", "orderId", "submissionId", "certificateId") <= 1);

ALTER TABLE "TicketAttachment"
  DROP CONSTRAINT "TicketAttachment_messageId_fkey",
  ADD CONSTRAINT "TicketAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "TicketMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TicketAttachment_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TicketAttachment_positive_size_check"
  CHECK ("sizeBytes" > 0);

ALTER TABLE "TicketEvent"
  ADD CONSTRAINT "TicketEvent_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TicketEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
