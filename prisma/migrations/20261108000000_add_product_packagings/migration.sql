-- DropIndex
DROP INDEX "products_gtin_key";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "gtin";

-- CreateTable
CREATE TABLE "product_packagings" (
    "id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "content" DECIMAL(18,6) NOT NULL,
    "gtin" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_packagings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_packagings_gtin_key" ON "product_packagings"("gtin");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_packagings_product_sku_content" ON "product_packagings"("product_sku", "content");

-- AddForeignKey
ALTER TABLE "product_packagings" ADD CONSTRAINT "product_packagings_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A packaging holds something.
ALTER TABLE "product_packagings" ADD CONSTRAINT "ck_product_packagings_content_positive" CHECK ("content" > 0);

-- Descriptions are kept in upper case. The ICU collation upper-cases accented letters whatever the
-- database collation is; two descriptions that only differed in case make this fail, by design.
UPDATE "products" SET "description" = upper("description" COLLATE "und-x-icu");
