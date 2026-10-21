-- CreateEnum
CREATE TYPE "PlaylistPageStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "playlist_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "youtubePlaylistId" TEXT,
    "status" "PlaylistPageStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "publishedTitle" TEXT,
    "publishedSummary" TEXT,
    "publishedBody" TEXT,
    "publishedSeoTitle" TEXT,
    "publishedSeoDescription" TEXT,
    "publishedMemberIds" JSONB,
    "publishedVersion" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "playlist_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_page_items" (
    "id" TEXT NOT NULL,
    "playlistPageId" TEXT NOT NULL,
    "videoPageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "note" TEXT,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_page_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_page_publications" (
    "id" TEXT NOT NULL,
    "playlistPageId" TEXT NOT NULL,
    "kind" "EditorialPublicationKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_page_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "playlist_pages_slug_key" ON "playlist_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_pages_youtubePlaylistId_key" ON "playlist_pages"("youtubePlaylistId");

-- CreateIndex
CREATE INDEX "playlist_pages_status_archivedAt_idx" ON "playlist_pages"("status", "archivedAt");

-- CreateIndex
CREATE INDEX "playlist_page_items_playlistPageId_position_idx" ON "playlist_page_items"("playlistPageId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_page_items_playlistPageId_videoPageId_key" ON "playlist_page_items"("playlistPageId", "videoPageId");

-- CreateIndex
CREATE INDEX "playlist_page_publications_playlistPageId_createdAt_idx" ON "playlist_page_publications"("playlistPageId", "createdAt");

-- AddForeignKey
ALTER TABLE "video_exposure_approvals" ADD CONSTRAINT "video_exposure_approvals_playlistPageId_fkey" FOREIGN KEY ("playlistPageId") REFERENCES "playlist_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_pages" ADD CONSTRAINT "playlist_pages_youtubePlaylistId_fkey" FOREIGN KEY ("youtubePlaylistId") REFERENCES "youtube_playlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_pages" ADD CONSTRAINT "playlist_pages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_pages" ADD CONSTRAINT "playlist_pages_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_pages" ADD CONSTRAINT "playlist_pages_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_page_items" ADD CONSTRAINT "playlist_page_items_playlistPageId_fkey" FOREIGN KEY ("playlistPageId") REFERENCES "playlist_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_page_items" ADD CONSTRAINT "playlist_page_items_videoPageId_fkey" FOREIGN KEY ("videoPageId") REFERENCES "youtube_video_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_page_items" ADD CONSTRAINT "playlist_page_items_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_page_publications" ADD CONSTRAINT "playlist_page_publications_playlistPageId_fkey" FOREIGN KEY ("playlistPageId") REFERENCES "playlist_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_page_publications" ADD CONSTRAINT "playlist_page_publications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

