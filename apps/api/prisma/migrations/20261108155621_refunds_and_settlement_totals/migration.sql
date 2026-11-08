-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commissionRefunded" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "refundTotal" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OrderRefund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "commissionReversed" INTEGER NOT NULL,
    "restocked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderRefund_orderId_idx" ON "OrderRefund"("orderId");

-- CreateIndex
CREATE INDEX "OrderRefund_settlementId_idx" ON "OrderRefund"("settlementId");

-- CreateIndex
CREATE INDEX "OrderRefund_createdAt_idx" ON "OrderRefund"("createdAt");

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
