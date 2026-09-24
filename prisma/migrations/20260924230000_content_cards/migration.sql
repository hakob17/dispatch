-- AlterEnum
ALTER TYPE "Channel" ADD VALUE 'CONTENT_CARD';

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "cardCategory" TEXT,
ADD COLUMN     "cardDismissible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cardPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cardStyle" TEXT;

