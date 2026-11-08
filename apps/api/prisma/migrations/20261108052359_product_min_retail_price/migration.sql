-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "minRetailPrice" INTEGER;

-- CreateIndex
CREATE INDEX "Product_minRetailPrice_idx" ON "Product"("minRetailPrice");

-- Backfill from active variants.
UPDATE "Product" p
SET "minRetailPrice" = (
  SELECT MIN(v."retailPrice") FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."isActive"
);
