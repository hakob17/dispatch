-- DropForeignKey
ALTER TABLE "JourneyStep" DROP CONSTRAINT "JourneyStep_templateId_fkey";

-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "entryKey" TEXT,
ADD COLUMN     "exitEvent" TEXT,
ADD COLUMN     "triggerEvent" TEXT;

-- AlterTable
ALTER TABLE "JourneyRun" ADD COLUMN     "currentKey" TEXT,
ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "waitUntil" TIMESTAMP(3),
ADD COLUMN     "waitingEvent" TEXT;

-- AlterTable
ALTER TABLE "JourneyStep" ADD COLUMN     "config" JSONB,
ADD COLUMN     "key" TEXT,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "next" JSONB,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'MESSAGE',
ALTER COLUMN "channel" DROP NOT NULL,
ALTER COLUMN "templateId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "JourneyVisit" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "branch" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JourneyVisit_journeyId_nodeKey_idx" ON "JourneyVisit"("journeyId", "nodeKey");

-- CreateIndex
CREATE INDEX "JourneyVisit_runId_idx" ON "JourneyVisit"("runId");

-- CreateIndex
CREATE INDEX "JourneyRun_contactId_waitingEvent_idx" ON "JourneyRun"("contactId", "waitingEvent");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyStep_journeyId_key_key" ON "JourneyStep"("journeyId", "key");

-- AddForeignKey
ALTER TABLE "JourneyStep" ADD CONSTRAINT "JourneyStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyVisit" ADD CONSTRAINT "JourneyVisit_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyVisit" ADD CONSTRAINT "JourneyVisit_runId_fkey" FOREIGN KEY ("runId") REFERENCES "JourneyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

