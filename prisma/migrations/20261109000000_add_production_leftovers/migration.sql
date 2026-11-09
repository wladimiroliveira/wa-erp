-- AlterEnum
ALTER TYPE "stock_movement_type" ADD VALUE 'OPENED_LEFTOVER';

-- AlterTable
ALTER TABLE "productions" ADD COLUMN     "has_leftovers_in_cost" BOOLEAN;

-- CreateTable
CREATE TABLE "production_leftovers" (
    "id" UUID NOT NULL,
    "input_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_leftovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_leftovers_movement_id_key" ON "production_leftovers"("movement_id");

-- CreateIndex
CREATE INDEX "idx_production_leftovers_input_id" ON "production_leftovers"("input_id");

-- CreateIndex
CREATE INDEX "idx_production_leftovers_lot_id" ON "production_leftovers"("lot_id");

-- AddForeignKey
ALTER TABLE "production_leftovers" ADD CONSTRAINT "production_leftovers_input_id_fkey" FOREIGN KEY ("input_id") REFERENCES "production_item_inputs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_leftovers" ADD CONSTRAINT "production_leftovers_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_leftovers" ADD CONSTRAINT "production_leftovers_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "production_leftovers" ADD CONSTRAINT "ck_production_leftovers_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "production_leftovers" ADD CONSTRAINT "ck_production_leftovers_unit_cost_non_negative" CHECK ("unit_cost" >= 0);
