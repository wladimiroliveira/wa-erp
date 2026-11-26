-- CreateEnum
CREATE TYPE "production_batch_source" AS ENUM ('PRODUCED', 'EXISTING');

-- CreateTable
CREATE TABLE "production_item_batches" (
    "id" UUID NOT NULL,
    "production_item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "source" "production_batch_source" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_item_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_item_weighings" (
    "production_item_id" UUID NOT NULL,
    "pre_weighing_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_item_weighings_pkey" PRIMARY KEY ("pre_weighing_id")
);

-- CreateIndex
CREATE INDEX "idx_production_item_batches_production_item_id" ON "production_item_batches"("production_item_id");

-- CreateIndex
CREATE INDEX "idx_production_item_weighings_production_item_id" ON "production_item_weighings"("production_item_id");

-- AddForeignKey
ALTER TABLE "production_item_batches" ADD CONSTRAINT "production_item_batches_production_item_id_fkey" FOREIGN KEY ("production_item_id") REFERENCES "production_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item_batches" ADD CONSTRAINT "production_item_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item_weighings" ADD CONSTRAINT "production_item_weighings_production_item_id_fkey" FOREIGN KEY ("production_item_id") REFERENCES "production_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_item_weighings" ADD CONSTRAINT "production_item_weighings_pre_weighing_id_fkey" FOREIGN KEY ("pre_weighing_id") REFERENCES "pre_weighings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
