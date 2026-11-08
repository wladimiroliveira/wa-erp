-- AlterTable
ALTER TABLE "stock_lots" ADD COLUMN     "package_count" INTEGER,
ADD COLUMN     "packaging_id" UUID;

-- CreateIndex
CREATE INDEX "idx_stock_lots_packaging_id" ON "stock_lots"("packaging_id");

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_packaging_id_fkey" FOREIGN KEY ("packaging_id") REFERENCES "product_packagings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A lot names its packaging and its count together, or neither.
ALTER TABLE "stock_lots" ADD CONSTRAINT "ck_stock_lots_packaging_count_together"
  CHECK (("packaging_id" IS NULL) = ("package_count" IS NULL));
ALTER TABLE "stock_lots" ADD CONSTRAINT "ck_stock_lots_package_count_positive"
  CHECK ("package_count" IS NULL OR "package_count" > 0);
