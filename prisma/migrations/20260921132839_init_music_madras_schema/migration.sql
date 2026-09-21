-- CreateEnum
CREATE TYPE "StudioRole" AS ENUM ('FOUNDER', 'SUPER_ADMINISTRATOR', 'ADMINISTRATOR', 'EDITOR', 'REVIEWER', 'CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "StudioUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RecordingAggregateStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "VenueType" AS ENUM ('CHURCH', 'CATHEDRAL', 'CONCERT_HALL', 'STUDIO', 'OUTDOOR');

-- CreateEnum
CREATE TYPE "MediaProvider" AS ENUM ('YOUTUBE', 'UPLOAD');

-- CreateEnum
CREATE TYPE "MediaRole" AS ENUM ('PRIMARY_VIDEO', 'THUMBNAIL', 'POSTER', 'PROGRAMME_PDF', 'SHEET_MUSIC', 'AUDIO_MASTER');

-- CreateEnum
CREATE TYPE "ObservabilityState" AS ENUM ('OBSERVED', 'NOT_OBSERVED', 'PRIVATE', 'UNLISTED', 'UNAVAILABLE', 'DELETED', 'SYNC_ERROR');

-- CreateEnum
CREATE TYPE "SheetMusicRequestStatus" AS ENUM ('NEW', 'IN_REVIEW', 'FULFILLED', 'DECLINED');

-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "YouTubeAnalyticsScope" AS ENUM ('CHANNEL', 'VIDEO');

-- CreateEnum
CREATE TYPE "YouTubeAnalyticsMetric" AS ENUM ('VIEWS', 'WATCH_TIME_MINUTES', 'AVERAGE_VIEW_DURATION_SECONDS', 'AVERAGE_VIEW_PERCENTAGE', 'LIKES', 'COMMENTS', 'SHARES', 'SUBSCRIBERS_GAINED', 'SUBSCRIBERS_LOST');

-- CreateTable
CREATE TABLE "studio_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StudioRole" NOT NULL,
    "status" "StudioUserStatus" NOT NULL DEFAULT 'INVITED',
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "studioUserId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_accounts" (
    "id" TEXT NOT NULL,
    "studioUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "expiresAt" INTEGER,
    "tokenType" TEXT,
    "scope" TEXT,
    "idToken" TEXT,
    "sessionState" TEXT,

    CONSTRAINT "studio_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StudioRole" NOT NULL,
    "invitedById" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "studioUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "composers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bornDate" TEXT,
    "diedDate" TEXT,
    "era" TEXT,
    "biography" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "composers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "musical_works" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "alternateTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" TEXT,
    "notes" TEXT,
    "catalogueNumber" TEXT,
    "keySignature" TEXT,
    "composerId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "musical_works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programmes" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_items" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "musicalWorkId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "movement" TEXT,
    "isEncore" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "programme_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performances" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "performanceDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "performances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrument" TEXT,
    "biography" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "choirs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "directorName" TEXT,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "choirs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conductors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "biography" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "conductors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_performers" (
    "performanceId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "performance_performers_pkey" PRIMARY KEY ("performanceId","artistId")
);

-- CreateTable
CREATE TABLE "performance_choirs" (
    "performanceId" TEXT NOT NULL,
    "choirId" TEXT NOT NULL,

    CONSTRAINT "performance_choirs_pkey" PRIMARY KEY ("performanceId","choirId")
);

-- CreateTable
CREATE TABLE "performance_conductors" (
    "performanceId" TEXT NOT NULL,
    "conductorId" TEXT NOT NULL,

    CONSTRAINT "performance_conductors_pkey" PRIMARY KEY ("performanceId","conductorId")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "VenueType" NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "capacity" INTEGER,
    "acousticProfile" TEXT,
    "organisationId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "buildYear" TEXT,
    "venueId" TEXT NOT NULL,
    "performanceId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "RecordingAggregateStatus" NOT NULL DEFAULT 'DRAFT',
    "currentDraftRevisionId" TEXT,
    "currentPublishedRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_revisions" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "revisionStatus" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "description" TEXT,
    "performanceId" TEXT,
    "seoMetaTitle" TEXT,
    "seoMetaDescription" TEXT,
    "seoCanonicalPath" TEXT,
    "educationalDifficultyLevel" TEXT,
    "educationalListeningGuide" TEXT,
    "educationalAnalysis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "recording_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_revision_works" (
    "revisionId" TEXT NOT NULL,
    "musicalWorkId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "catalogueNumberOverride" TEXT,

    CONSTRAINT "recording_revision_works_pkey" PRIMARY KEY ("revisionId","musicalWorkId")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "CollectionStatus" NOT NULL DEFAULT 'DRAFT',
    "backingPlaylistId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_recordings" (
    "collectionId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "collection_recordings_pkey" PRIMARY KEY ("collectionId","recordingId")
);

-- CreateTable
CREATE TABLE "collection_works" (
    "collectionId" TEXT NOT NULL,
    "musicalWorkId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "collection_works_pkey" PRIMARY KEY ("collectionId","musicalWorkId")
);

-- CreateTable
CREATE TABLE "learning_guides" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficultyLevel" TEXT,
    "contentMarkdown" TEXT,
    "estimatedReadingTimeMinutes" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "learning_guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_guide_works" (
    "learningGuideId" TEXT NOT NULL,
    "musicalWorkId" TEXT NOT NULL,

    CONSTRAINT "learning_guide_works_pkey" PRIMARY KEY ("learningGuideId","musicalWorkId")
);

-- CreateTable
CREATE TABLE "learning_guide_recordings" (
    "learningGuideId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,

    CONSTRAINT "learning_guide_recordings_pkey" PRIMARY KEY ("learningGuideId","recordingId")
);

-- CreateTable
CREATE TABLE "educational_content" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "educational_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_content" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "editorial_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_resources" (
    "id" TEXT NOT NULL,
    "provider" "MediaProvider" NOT NULL,
    "providerResourceId" TEXT,
    "role" "MediaRole" NOT NULL,
    "url" TEXT,
    "recordingRevisionId" TEXT,
    "composerId" TEXT,
    "venueId" TEXT,
    "collectionId" TEXT,
    "learningGuideId" TEXT,
    "editorialContentId" TEXT,
    "youtubeVideoId" TEXT,
    "rightsInformationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_videos" (
    "id" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "etag" TEXT,
    "contentHash" TEXT,
    "observabilityState" "ObservabilityState" NOT NULL DEFAULT 'OBSERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_playlists" (
    "id" TEXT NOT NULL,
    "youtubePlaylistId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "etag" TEXT,
    "contentHash" TEXT,
    "observabilityState" "ObservabilityState" NOT NULL DEFAULT 'OBSERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_playlist_items" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "etag" TEXT,
    "observabilityState" "ObservabilityState" NOT NULL DEFAULT 'OBSERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_playlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youtube_analytics_observations" (
    "id" TEXT NOT NULL,
    "scope" "YouTubeAnalyticsScope" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "youtubeVideoId" TEXT,
    "channelId" TEXT,
    "metric" "YouTubeAnalyticsMetric" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "dimensions" JSONB,
    "dimensionsHash" TEXT NOT NULL DEFAULT '',
    "syncJobRunId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'youtube_analytics_api',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "youtube_analytics_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_music_requests" (
    "id" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "musicalWorkId" TEXT,
    "recordingId" TEXT,
    "instrumentOrVoice" TEXT,
    "intendedUse" TEXT,
    "message" TEXT,
    "status" "SheetMusicRequestStatus" NOT NULL DEFAULT 'NEW',
    "consentGivenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheet_music_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "url" TEXT,
    "publisher" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" TEXT NOT NULL,
    "text" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rights_information" (
    "id" TEXT NOT NULL,
    "holder" TEXT,
    "licenseType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rights_information_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_sources" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "entity_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_rights" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "rightsInformationId" TEXT NOT NULL,

    CONSTRAINT "entity_rights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_educational_content" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "educationalContentId" TEXT NOT NULL,

    CONSTRAINT "entity_educational_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studio_users_email_key" ON "studio_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "studio_sessions_sessionToken_key" ON "studio_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "studio_sessions_studioUserId_idx" ON "studio_sessions"("studioUserId");

-- CreateIndex
CREATE INDEX "studio_accounts_studioUserId_idx" ON "studio_accounts"("studioUserId");

-- CreateIndex
CREATE UNIQUE INDEX "studio_accounts_provider_providerAccountId_key" ON "studio_accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_studioUserId_idx" ON "password_reset_tokens"("studioUserId");

-- CreateIndex
CREATE UNIQUE INDEX "composers_slug_key" ON "composers"("slug");

-- CreateIndex
CREATE INDEX "composers_archivedAt_idx" ON "composers"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "musical_works_slug_key" ON "musical_works"("slug");

-- CreateIndex
CREATE INDEX "musical_works_composerId_idx" ON "musical_works"("composerId");

-- CreateIndex
CREATE INDEX "musical_works_archivedAt_idx" ON "musical_works"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "programmes_slug_key" ON "programmes"("slug");

-- CreateIndex
CREATE INDEX "programmes_archivedAt_idx" ON "programmes"("archivedAt");

-- CreateIndex
CREATE INDEX "programme_items_musicalWorkId_idx" ON "programme_items"("musicalWorkId");

-- CreateIndex
CREATE UNIQUE INDEX "programme_items_programmeId_order_key" ON "programme_items"("programmeId", "order");

-- CreateIndex
CREATE INDEX "performances_programmeId_idx" ON "performances"("programmeId");

-- CreateIndex
CREATE INDEX "performances_venueId_idx" ON "performances"("venueId");

-- CreateIndex
CREATE INDEX "performances_archivedAt_idx" ON "performances"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "venues_slug_key" ON "venues"("slug");

-- CreateIndex
CREATE INDEX "venues_archivedAt_idx" ON "venues"("archivedAt");

-- CreateIndex
CREATE INDEX "venues_organisationId_idx" ON "venues"("organisationId");

-- CreateIndex
CREATE INDEX "instruments_venueId_idx" ON "instruments"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_slug_key" ON "recordings"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_currentDraftRevisionId_key" ON "recordings"("currentDraftRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_currentPublishedRevisionId_key" ON "recordings"("currentPublishedRevisionId");

-- CreateIndex
CREATE INDEX "recording_revisions_performanceId_idx" ON "recording_revisions"("performanceId");

-- CreateIndex
CREATE UNIQUE INDEX "recording_revisions_recordingId_revisionNumber_key" ON "recording_revisions"("recordingId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");

-- CreateIndex
CREATE INDEX "collections_archivedAt_idx" ON "collections"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "learning_guides_slug_key" ON "learning_guides"("slug");

-- CreateIndex
CREATE INDEX "learning_guides_archivedAt_idx" ON "learning_guides"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "editorial_content_slug_key" ON "editorial_content"("slug");

-- CreateIndex
CREATE INDEX "editorial_content_archivedAt_idx" ON "editorial_content"("archivedAt");

-- CreateIndex
CREATE INDEX "media_resources_recordingRevisionId_idx" ON "media_resources"("recordingRevisionId");

-- CreateIndex
CREATE INDEX "media_resources_youtubeVideoId_idx" ON "media_resources"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "media_resources_rightsInformationId_idx" ON "media_resources"("rightsInformationId");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_videos_youtubeVideoId_key" ON "youtube_videos"("youtubeVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_playlists_youtubePlaylistId_key" ON "youtube_playlists"("youtubePlaylistId");

-- CreateIndex
CREATE INDEX "youtube_playlist_items_playlistId_position_idx" ON "youtube_playlist_items"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_playlist_items_playlistId_youtubeVideoId_key" ON "youtube_playlist_items"("playlistId", "youtubeVideoId");

-- CreateIndex
CREATE INDEX "youtube_analytics_observations_youtubeVideoId_metric_period_idx" ON "youtube_analytics_observations"("youtubeVideoId", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "youtube_analytics_observations_channelId_metric_periodStart_idx" ON "youtube_analytics_observations"("channelId", "metric", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "youtube_analytics_observations_scope_targetKey_metric_perio_key" ON "youtube_analytics_observations"("scope", "targetKey", "metric", "periodStart", "periodEnd", "dimensionsHash");

-- CreateIndex
CREATE INDEX "sheet_music_requests_musicalWorkId_idx" ON "sheet_music_requests"("musicalWorkId");

-- CreateIndex
CREATE INDEX "sheet_music_requests_status_idx" ON "sheet_music_requests"("status");

-- CreateIndex
CREATE INDEX "entity_sources_entityType_entityId_idx" ON "entity_sources"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "entity_rights_entityType_entityId_idx" ON "entity_rights"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "entity_educational_content_entityType_entityId_idx" ON "entity_educational_content"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_entries_entityType_entityId_idx" ON "audit_log_entries"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_entries_timestamp_idx" ON "audit_log_entries"("timestamp");

-- AddForeignKey
ALTER TABLE "studio_sessions" ADD CONSTRAINT "studio_sessions_studioUserId_fkey" FOREIGN KEY ("studioUserId") REFERENCES "studio_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_accounts" ADD CONSTRAINT "studio_accounts_studioUserId_fkey" FOREIGN KEY ("studioUserId") REFERENCES "studio_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_studioUserId_fkey" FOREIGN KEY ("studioUserId") REFERENCES "studio_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composers" ADD CONSTRAINT "composers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composers" ADD CONSTRAINT "composers_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "musical_works" ADD CONSTRAINT "musical_works_composerId_fkey" FOREIGN KEY ("composerId") REFERENCES "composers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "musical_works" ADD CONSTRAINT "musical_works_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "musical_works" ADD CONSTRAINT "musical_works_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_items" ADD CONSTRAINT "programme_items_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_items" ADD CONSTRAINT "programme_items_musicalWorkId_fkey" FOREIGN KEY ("musicalWorkId") REFERENCES "musical_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performances" ADD CONSTRAINT "performances_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performances" ADD CONSTRAINT "performances_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performances" ADD CONSTRAINT "performances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performances" ADD CONSTRAINT "performances_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artists" ADD CONSTRAINT "artists_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artists" ADD CONSTRAINT "artists_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "choirs" ADD CONSTRAINT "choirs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "choirs" ADD CONSTRAINT "choirs_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conductors" ADD CONSTRAINT "conductors_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conductors" ADD CONSTRAINT "conductors_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_performers" ADD CONSTRAINT "performance_performers_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "performances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_performers" ADD CONSTRAINT "performance_performers_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_choirs" ADD CONSTRAINT "performance_choirs_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "performances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_choirs" ADD CONSTRAINT "performance_choirs_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "choirs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_conductors" ADD CONSTRAINT "performance_conductors_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "performances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_conductors" ADD CONSTRAINT "performance_conductors_conductorId_fkey" FOREIGN KEY ("conductorId") REFERENCES "conductors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "performances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_currentDraftRevisionId_fkey" FOREIGN KEY ("currentDraftRevisionId") REFERENCES "recording_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_currentPublishedRevisionId_fkey" FOREIGN KEY ("currentPublishedRevisionId") REFERENCES "recording_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revisions" ADD CONSTRAINT "recording_revisions_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "performances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revisions" ADD CONSTRAINT "recording_revisions_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revisions" ADD CONSTRAINT "recording_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revisions" ADD CONSTRAINT "recording_revisions_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revision_works" ADD CONSTRAINT "recording_revision_works_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "recording_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revision_works" ADD CONSTRAINT "recording_revision_works_musicalWorkId_fkey" FOREIGN KEY ("musicalWorkId") REFERENCES "musical_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_backingPlaylistId_fkey" FOREIGN KEY ("backingPlaylistId") REFERENCES "youtube_playlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_recordings" ADD CONSTRAINT "collection_recordings_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_recordings" ADD CONSTRAINT "collection_recordings_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_works" ADD CONSTRAINT "collection_works_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_works" ADD CONSTRAINT "collection_works_musicalWorkId_fkey" FOREIGN KEY ("musicalWorkId") REFERENCES "musical_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_guides" ADD CONSTRAINT "learning_guides_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_guides" ADD CONSTRAINT "learning_guides_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_guide_works" ADD CONSTRAINT "learning_guide_works_learningGuideId_fkey" FOREIGN KEY ("learningGuideId") REFERENCES "learning_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_guide_works" ADD CONSTRAINT "learning_guide_works_musicalWorkId_fkey" FOREIGN KEY ("musicalWorkId") REFERENCES "musical_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_guide_recordings" ADD CONSTRAINT "learning_guide_recordings_learningGuideId_fkey" FOREIGN KEY ("learningGuideId") REFERENCES "learning_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_guide_recordings" ADD CONSTRAINT "learning_guide_recordings_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_content" ADD CONSTRAINT "editorial_content_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_content" ADD CONSTRAINT "editorial_content_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_resources" ADD CONSTRAINT "media_resources_recordingRevisionId_fkey" FOREIGN KEY ("recordingRevisionId") REFERENCES "recording_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_resources" ADD CONSTRAINT "media_resources_composerId_fkey" FOREIGN KEY ("composerId") REFERENCES "composers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_resources" ADD CONSTRAINT "media_resources_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_resources" ADD CONSTRAINT "media_resources_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_resources" ADD CONSTRAINT "media_resources_learningGuideId_fkey" FOREIGN KEY ("learningGuideId") REFERENCES "learning_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_resources" ADD CONSTRAINT "media_resources_editorialContentId_fkey" FOREIGN KEY ("editorialContentId") REFERENCES "editorial_content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_resources" ADD CONSTRAINT "media_resources_youtubeVideoId_fkey" FOREIGN KEY ("youtubeVideoId") REFERENCES "youtube_videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_resources" ADD CONSTRAINT "media_resources_rightsInformationId_fkey" FOREIGN KEY ("rightsInformationId") REFERENCES "rights_information"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_playlist_items" ADD CONSTRAINT "youtube_playlist_items_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "youtube_playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_playlist_items" ADD CONSTRAINT "youtube_playlist_items_youtubeVideoId_fkey" FOREIGN KEY ("youtubeVideoId") REFERENCES "youtube_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youtube_analytics_observations" ADD CONSTRAINT "youtube_analytics_observations_youtubeVideoId_fkey" FOREIGN KEY ("youtubeVideoId") REFERENCES "youtube_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_music_requests" ADD CONSTRAINT "sheet_music_requests_musicalWorkId_fkey" FOREIGN KEY ("musicalWorkId") REFERENCES "musical_works"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_music_requests" ADD CONSTRAINT "sheet_music_requests_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_sources" ADD CONSTRAINT "entity_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_rights" ADD CONSTRAINT "entity_rights_rightsInformationId_fkey" FOREIGN KEY ("rightsInformationId") REFERENCES "rights_information"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_educational_content" ADD CONSTRAINT "entity_educational_content_educationalContentId_fkey" FOREIGN KEY ("educationalContentId") REFERENCES "educational_content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
