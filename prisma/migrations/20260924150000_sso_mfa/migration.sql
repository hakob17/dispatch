-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaLastStep" INTEGER,
ADD COLUMN     "mfaRecoveryCodes" JSONB,
ADD COLUMN     "mfaSecret" TEXT,
ADD COLUMN     "ssoSubject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_ssoSubject_key" ON "User"("ssoSubject");

