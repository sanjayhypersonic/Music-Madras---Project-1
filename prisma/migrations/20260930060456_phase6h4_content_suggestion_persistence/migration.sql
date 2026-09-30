-- CreateEnum
CREATE TYPE "ContentSuggestionType" AS ENUM ('EDITORIAL_PROSE', 'SEO_METADATA', 'INTERNAL_LINK', 'INFORMATION_GAP', 'SOURCE_LEAD', 'SEARCH_TERMINOLOGY', 'CANONICAL_RELATIONSHIP_CANDIDATE');

-- CreateEnum
CREATE TYPE "ContentGenerationStatus" AS ENUM ('PENDING', 'GENERATING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentSuggestionStatus" AS ENUM ('DRAFT_READY', 'EDITOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContentSuggestionReviewDecision" AS ENUM ('ACCEPT', 'EDIT_AND_ACCEPT', 'REJECT_UNSUPPORTED', 'REJECT_INCORRECT', 'REJECT_DUPLICATE', 'REJECT_OTHER');

-- CreateTable
CREATE TABLE "content_generation_requests" (
    "id" TEXT NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "suggestionType" "ContentSuggestionType" NOT NULL,
    "status" "ContentGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "contextFingerprint" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorDetails" TEXT,

    CONSTRAINT "content_generation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_suggestions" (
    "id" TEXT NOT NULL,
    "generationRequestId" TEXT NOT NULL,
    "suggestionType" "ContentSuggestionType" NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "targetField" TEXT,
    "proposedContent" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "status" "ContentSuggestionStatus" NOT NULL DEFAULT 'DRAFT_READY',
    "reviewedById" TEXT,
    "reviewDecision" "ContentSuggestionReviewDecision",
    "reviewNote" TEXT,
    "finalContent" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_generation_requests_targetEntityType_targetEntityId_idx" ON "content_generation_requests"("targetEntityType", "targetEntityId");

-- CreateIndex
CREATE INDEX "content_suggestions_targetEntityType_targetEntityId_idx" ON "content_suggestions"("targetEntityType", "targetEntityId");

-- CreateIndex
CREATE INDEX "content_suggestions_status_idx" ON "content_suggestions"("status");

-- AddForeignKey
ALTER TABLE "content_generation_requests" ADD CONSTRAINT "content_generation_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_suggestions" ADD CONSTRAINT "content_suggestions_generationRequestId_fkey" FOREIGN KEY ("generationRequestId") REFERENCES "content_generation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_suggestions" ADD CONSTRAINT "content_suggestions_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
