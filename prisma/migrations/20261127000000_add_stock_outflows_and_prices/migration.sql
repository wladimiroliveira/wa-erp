-- CreateEnum
CREATE TYPE "stock_outflow_kind" AS ENUM ('SALE', 'DONATION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "stock_movement_type" ADD VALUE 'SALE';
ALTER TYPE "stock_movement_type" ADD VALUE 'DONATION';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "outflow_id" UUID;

-- CreateTable
CREATE TABLE "product_prices" (
    "id" UUID NOT NULL,
    "product_sku" UUID NOT NULL,
    "average_cost" DECIMAL(18,6) NOT NULL,
    "markup_percent" DECIMAL(7,2) NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_outflows" (
    "id" UUID NOT NULL,
    "kind" "stock_outflow_kind" NOT NULL,
    "product_sku" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "list_price" DECIMAL(14,2),
    "unit_price" DECIMAL(14,2),
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_outflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_product_prices_product_sku_created_at" ON "product_prices"("product_sku", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "idx_stock_outflows_created_at" ON "stock_outflows"("created_at");

-- CreateIndex
CREATE INDEX "idx_stock_outflows_product_sku_created_at" ON "stock_outflows"("product_sku", "created_at");

-- CreateIndex
CREATE INDEX "idx_stock_movements_outflow_id" ON "stock_movements"("outflow_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_outflow_id_fkey" FOREIGN KEY ("outflow_id") REFERENCES "stock_outflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_outflows" ADD CONSTRAINT "stock_outflows_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_outflows" ADD CONSTRAINT "stock_outflows_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A sale carries both prices, a donation neither.
ALTER TABLE stock_outflows ADD CONSTRAINT ck_stock_outflows_prices_by_kind CHECK ((kind = 'SALE' AND list_price IS NOT NULL AND unit_price IS NOT NULL) OR (kind = 'DONATION' AND list_price IS NULL AND unit_price IS NULL));
