-- CreateEnum
CREATE TYPE "VideoPageStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "youtube_video_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "status" "VideoPageStatus" NOT NULL DEFAULT 'DRAFT',
    "curatorNote" TEXT,
    "seoMetaTitle" TEXT,
    "seoMetaDescription" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "youtube_video_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "youtube_video_pages_slug_key" ON "youtube_video_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_video_pages_youtubeVideoId_key" ON "youtube_video_pages"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "youtube_video_pages_archivedAt_idx" ON "youtube_video_pages"("archivedAt");

-- AddForeignKey
ALTER TABLE "youtube_video_pages" ADD CONSTRAINT "youtube_video_pages_youtubeVideoId_fkey" FOREIGN KEY ("youtubeVideoId") REFERENCES "youtube_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_video_pages" ADD CONSTRAINT "youtube_video_pages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_video_pages" ADD CONSTRAINT "youtube_video_pages_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
