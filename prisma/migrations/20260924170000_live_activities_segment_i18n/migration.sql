-- CreateEnum
CREATE TYPE "LiveActivityStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "LiveActivityTokenKind" AS ENUM ('UPDATE', 'PUSH_TO_START', 'FOLLOW');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'WEBHOOK';

-- CreateTable
CREATE TABLE "LiveActivity" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "contentState" JSONB NOT NULL DEFAULT '{}',
    "status" "LiveActivityStatus" NOT NULL DEFAULT 'ACTIVE',
    "updatesSent" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveActivityToken" (
    "id" TEXT NOT NULL,
    "kind" "LiveActivityTokenKind" NOT NULL,
    "contactId" TEXT NOT NULL,
    "activityKey" TEXT,
    "activityType" TEXT,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveActivityToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveActivity_key_key" ON "LiveActivity"("key");

-- CreateIndex
CREATE INDEX "LiveActivityToken_activityKey_kind_isActive_idx" ON "LiveActivityToken"("activityKey", "kind", "isActive");

-- CreateIndex
CREATE INDEX "LiveActivityToken_activityType_kind_isActive_idx" ON "LiveActivityToken"("activityType", "kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LiveActivityToken_kind_token_activityKey_key" ON "LiveActivityToken"("kind", "token", "activityKey");

-- AddForeignKey
ALTER TABLE "LiveActivityToken" ADD CONSTRAINT "LiveActivityToken_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

