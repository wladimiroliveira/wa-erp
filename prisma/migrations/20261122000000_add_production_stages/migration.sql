-- CreateEnum
CREATE TYPE "production_item_status" AS ENUM ('PENDING', 'FINISHED', 'SUBSTITUTED');

-- AlterTable
ALTER TABLE "production_items" ADD COLUMN     "finished_at" TIMESTAMPTZ(3),
ADD COLUMN     "has_leftovers_in_cost" BOOLEAN,
ADD COLUMN     "status" "production_item_status" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "stock_losses" ADD COLUMN     "damage_id" UUID;

-- CreateTable
CREATE TABLE "production_item_damages" (
    "id" UUID NOT NULL,
    "production_item_id" UUID NOT NULL,
    "pre_weighing_id" UUID,
    "reason_id" UUID NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_item_damages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_item_damages_pre_weighing_id_key" ON "production_item_damages"("pre_weighing_id");

-- CreateIndex
CREATE INDEX "idx_production_item_damages_production_item_id" ON "production_item_damages"("production_item_id");

-- CreateIndex
CREATE INDEX "idx_production_item_damages_reason_id" ON "production_item_damages"("reason_id");

-- CreateIndex
CREATE INDEX "idx_production_item_damages_created_by_id" ON "production_item_damages"("created_by_id");

-- CreateIndex
CREATE INDEX "idx_stock_losses_damage_id" ON "stock_losses"("damage_id");

-- AddForeignKey
ALTER TABLE "production_item_damages" ADD CONSTRAINT "production_item_damages_production_item_id_fkey" FOREIGN KEY ("production_item_id") REFERENCES "production_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item_damages" ADD CONSTRAINT "production_item_damages_pre_weighing_id_fkey" FOREIGN KEY ("pre_weighing_id") REFERENCES "pre_weighings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item_damages" ADD CONSTRAINT "production_item_damages_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "loss_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item_damages" ADD CONSTRAINT "production_item_damages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_losses" ADD CONSTRAINT "stock_losses_damage_id_fkey" FOREIGN KEY ("damage_id") REFERENCES "production_item_damages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Items of a production that already finished keep what the production recorded.
UPDATE production_items AS item
SET status = 'FINISHED', finished_at = production.finished_at,
    has_leftovers_in_cost = production.has_leftovers_in_cost
FROM productions AS production
WHERE item.production_id = production.id AND production.status = 'FINISHED';

-- AlterTable
ALTER TABLE "productions" DROP COLUMN "has_leftovers_in_cost";
