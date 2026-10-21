-- CreateTable
CREATE TABLE "featured_videos" (
    "id" TEXT NOT NULL,
    "videoPageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "note" TEXT,
    "pinnedById" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "featured_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "featured_videos_videoPageId_key" ON "featured_videos"("videoPageId");

-- CreateIndex
CREATE INDEX "featured_videos_position_idx" ON "featured_videos"("position");

-- AddForeignKey
ALTER TABLE "featured_videos" ADD CONSTRAINT "featured_videos_videoPageId_fkey" FOREIGN KEY ("videoPageId") REFERENCES "youtube_video_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "featured_videos" ADD CONSTRAINT "featured_videos_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

