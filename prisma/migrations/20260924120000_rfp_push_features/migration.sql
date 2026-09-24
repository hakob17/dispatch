-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('SERVER', 'SDK');

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "scope" "ApiKeyScope" NOT NULL DEFAULT 'SERVER';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "bypassDeliveryRules" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "anonymousId" TEXT,
ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "pushCollapseKey" TEXT,
ADD COLUMN     "pushData" JSONB,
ADD COLUMN     "pushImageUrl" TEXT,
ADD COLUMN     "pushPriority" TEXT NOT NULL DEFAULT 'HIGH',
ADD COLUMN     "pushTtlSeconds" INTEGER;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "appVersion" TEXT,
ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "platform" TEXT;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "status" INTEGER,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_externalId_key" ON "Contact"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_anonymousId_key" ON "Contact"("anonymousId");

-- CreateIndex
CREATE INDEX "PushSubscription_contactId_channel_isActive_idx" ON "PushSubscription"("contactId", "channel", "isActive");

