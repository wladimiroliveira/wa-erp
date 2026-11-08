-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "permission" ADD VALUE 'PRICING_READ';
ALTER TYPE "permission" ADD VALUE 'PRICING_UPDATE';

-- CreateTable
CREATE TABLE "product_markups" (
    "product_sku" UUID NOT NULL,
    "markup_percent" DECIMAL(7,2) NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_markups_pkey" PRIMARY KEY ("product_sku")
);

-- CreateIndex
CREATE INDEX "idx_product_markups_updated_by_id" ON "product_markups"("updated_by_id");

-- AddForeignKey
ALTER TABLE "product_markups" ADD CONSTRAINT "product_markups_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_markups" ADD CONSTRAINT "product_markups_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

