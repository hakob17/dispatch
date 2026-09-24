-- AlterEnum
ALTER TYPE "SuppressionReason" ADD VALUE 'STOP';

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "smsBody" TEXT,
ADD COLUMN     "whatsappContentSid" TEXT,
ADD COLUMN     "whatsappVariables" JSONB;

