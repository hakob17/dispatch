-- CreateTable
CREATE TABLE "SystemAlert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemAlert_key_resolvedAt_idx" ON "SystemAlert"("key", "resolvedAt");

-- CreateIndex
CREATE INDEX "SystemAlert_resolvedAt_lastAt_idx" ON "SystemAlert"("resolvedAt", "lastAt");

