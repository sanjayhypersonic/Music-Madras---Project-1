-- AlterTable
ALTER TABLE "youtube_playlists" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "privacyStatus" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "thumbnailUrl" TEXT;

-- AlterTable
ALTER TABLE "youtube_videos" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "currentCommentCount" INTEGER,
ADD COLUMN     "currentLikeCount" INTEGER,
ADD COLUMN     "currentViewCount" INTEGER,
ADD COLUMN     "embeddable" BOOLEAN,
ADD COLUMN     "privacyStatus" TEXT,
ADD COLUMN     "statisticsUpdatedAt" TIMESTAMP(3);
