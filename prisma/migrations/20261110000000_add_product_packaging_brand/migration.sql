-- The product becomes the commodity a recipe takes; the brand moves down to the packaging it is bought in.
-- Packagings registered before this get a placeholder brand: there is no real data to carry over.
ALTER TABLE "product_packagings" ADD COLUMN "brand" TEXT NOT NULL DEFAULT 'SEM MARCA';
ALTER TABLE "product_packagings" ALTER COLUMN "brand" DROP DEFAULT;

DROP INDEX "uq_product_packagings_product_sku_content";

CREATE UNIQUE INDEX "uq_product_packagings_product_sku_brand_content" ON "product_packagings"("product_sku", "brand", "content");
