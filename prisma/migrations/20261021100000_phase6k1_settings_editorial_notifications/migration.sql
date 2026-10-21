-- Phase 6K-1: typed site settings, EditorialContent draft/publish lifecycle, in-Studio notifications.
--
-- Additive only: six new enums, five new tables, and two columns' worth of lifecycle fields on editorial_content (all NULLable
-- or defaulted: status DEFAULT 'DRAFT', version DEFAULT 1), so existing editorial_content rows (none are read by any code) become
-- unpublished drafts and nothing is exposed. No existing column is altered or dropped, no row is rewritten.
--
-- Rollout: apply BEFORE deploying the code that reads these tables. Rolling the code back leaves the tables harmless.
-- CreateEnum
CREATE TYPE "EditorialContentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "EditorialPublicationKind" AS ENUM ('PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'ACTION_REQUIRED', 'WARNING');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_STUDIO', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('DELIVERED', 'PENDING', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "editorial_content" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedBody" TEXT,
ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "publishedSeoDescription" TEXT,
ADD COLUMN     "publishedSeoTitle" TEXT,
ADD COLUMN     "publishedTitle" TEXT,
ADD COLUMN     "publishedVersion" INTEGER,
ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "seoTitle" TEXT,
ADD COLUMN     "status" "EditorialContentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "editorial_content_publications" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "kind" "EditorialPublicationKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editorial_content_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "studio_notifications" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "audienceAction" TEXT NOT NULL,
    "contentFingerprint" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'OPEN',
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstRaisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRaisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedReason" TEXT,

    CONSTRAINT "studio_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_notification_reads" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_notification_reads_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateTable
CREATE TABLE "studio_notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "editorial_content_publications_contentId_createdAt_idx" ON "editorial_content_publications"("contentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "studio_notifications_dedupeKey_key" ON "studio_notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "studio_notifications_status_audienceAction_idx" ON "studio_notifications"("status", "audienceAction");

-- CreateIndex
CREATE INDEX "studio_notification_deliveries_status_nextAttemptAt_idx" ON "studio_notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "studio_notification_deliveries_notificationId_channel_recip_key" ON "studio_notification_deliveries"("notificationId", "channel", "recipientUserId");

-- AddForeignKey
ALTER TABLE "editorial_content" ADD CONSTRAINT "editorial_content_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_content_publications" ADD CONSTRAINT "editorial_content_publications_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "editorial_content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_content_publications" ADD CONSTRAINT "editorial_content_publications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_notification_reads" ADD CONSTRAINT "studio_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "studio_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_notification_reads" ADD CONSTRAINT "studio_notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "studio_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_notification_deliveries" ADD CONSTRAINT "studio_notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "studio_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_notification_deliveries" ADD CONSTRAINT "studio_notification_deliveries_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "studio_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
