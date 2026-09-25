-- CreateTable
CREATE TABLE "occasions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "occasions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_occasions" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,

    CONSTRAINT "entity_occasions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "occasions_slug_key" ON "occasions"("slug");

-- CreateIndex
CREATE INDEX "occasions_archivedAt_idx" ON "occasions"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "entity_occasions_entityType_entityId_occasionId_key" ON "entity_occasions"("entityType", "entityId", "occasionId");

-- CreateIndex
CREATE INDEX "entity_occasions_entityType_entityId_idx" ON "entity_occasions"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "entity_occasions_occasionId_idx" ON "entity_occasions"("occasionId");

-- AddForeignKey
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_occasions" ADD CONSTRAINT "entity_occasions_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "occasions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
