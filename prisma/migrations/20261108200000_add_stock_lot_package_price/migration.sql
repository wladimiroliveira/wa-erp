-- AlterTable
ALTER TABLE "stock_lots" ADD COLUMN     "package_price" DECIMAL(14,2);

-- Lots received in packagings before the price was kept: the price their cost per unit amounts to.
UPDATE "stock_lots" AS l
   SET "package_price" = round(l."unit_cost" * p."content", 2)
  FROM "product_packagings" AS p
 WHERE l."packaging_id" = p."id";

ALTER TABLE "stock_lots" ADD CONSTRAINT "ck_stock_lots_package_price_together"
  CHECK (("packaging_id" IS NULL) = ("package_price" IS NULL));
ALTER TABLE "stock_lots" ADD CONSTRAINT "ck_stock_lots_package_price_non_negative"
  CHECK ("package_price" IS NULL OR "package_price" >= 0);
