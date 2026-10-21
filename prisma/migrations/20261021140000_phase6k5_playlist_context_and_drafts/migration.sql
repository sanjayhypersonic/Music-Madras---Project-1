-- CreateEnum
CREATE TYPE "PlaylistInputSource" AS ENUM ('AI_QUESTION', 'EDITOR_NOTE');

-- CreateEnum
CREATE TYPE "PlaylistInputStatus" AS ENUM ('AWAITING_ANSWER', 'ACTIVE', 'SKIPPED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PlaylistDraftTarget" AS ENUM ('SUMMARY', 'BODY');

-- CreateEnum
CREATE TYPE "PlaylistDraftStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "playlist_context_inputs" (
    "id" TEXT NOT NULL,
    "playlistPageId" TEXT NOT NULL,
    "source" "PlaylistInputSource" NOT NULL,
    "status" "PlaylistInputStatus" NOT NULL,
    "question" TEXT,
    "body" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "playlist_context_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_draft_proposals" (
    "id" TEXT NOT NULL,
    "playlistPageId" TEXT NOT NULL,
    "target" "PlaylistDraftTarget" NOT NULL,
    "proposedContent" TEXT NOT NULL,
    "claims" JSONB NOT NULL,
    "evidenceFingerprint" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "PlaylistDraftStatus" NOT NULL DEFAULT 'PROPOSED',
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "playlist_draft_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "playlist_context_inputs_playlistPageId_status_idx" ON "playlist_context_inputs"("playlistPageId", "status");

-- CreateIndex
CREATE INDEX "playlist_draft_proposals_playlistPageId_status_idx" ON "playlist_draft_proposals"("playlistPageId", "status");

-- AddForeignKey
ALTER TABLE "playlist_context_inputs" ADD CONSTRAINT "playlist_context_inputs_playlistPageId_fkey" FOREIGN KEY ("playlistPageId") REFERENCES "playlist_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_context_inputs" ADD CONSTRAINT "playlist_context_inputs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_context_inputs" ADD CONSTRAINT "playlist_context_inputs_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_context_inputs" ADD CONSTRAINT "playlist_context_inputs_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_draft_proposals" ADD CONSTRAINT "playlist_draft_proposals_playlistPageId_fkey" FOREIGN KEY ("playlistPageId") REFERENCES "playlist_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_draft_proposals" ADD CONSTRAINT "playlist_draft_proposals_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_draft_proposals" ADD CONSTRAINT "playlist_draft_proposals_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

