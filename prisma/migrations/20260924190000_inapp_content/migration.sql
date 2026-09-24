-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'IN_APP';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "content" JSONB,
ADD COLUMN     "contentItemId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "inAppButtons" JSONB,
ADD COLUMN     "inAppExpiresHours" INTEGER,
ADD COLUMN     "inAppLayout" TEXT;

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "summary" TEXT,
    "imageUrl" TEXT,
    "section" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "language" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentFeed" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'AUTO',
    "section" TEXT,
    "pollMinutes" INTEGER NOT NULL DEFAULT 5,
    "autoCampaignId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "itemsIngested" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_externalId_key" ON "ContentItem"("externalId");

-- CreateIndex
CREATE INDEX "ContentItem_publishedAt_idx" ON "ContentItem"("publishedAt");

-- CreateIndex
CREATE INDEX "ContentItem_section_publishedAt_idx" ON "ContentItem"("section", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentFeed_url_key" ON "ContentFeed"("url");

-- CreateIndex
CREATE INDEX "Message_contactId_channel_status_idx" ON "Message"("contactId", "channel", "status");

