-- AlterTable
ALTER TABLE "SubscriptionGroup" ADD COLUMN     "optIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionGroup_slug_key" ON "SubscriptionGroup"("slug");

