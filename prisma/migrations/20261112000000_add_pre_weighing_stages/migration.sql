-- AlterTable
ALTER TABLE "pre_weighing_items" ALTER COLUMN "weighed_quantity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "pre_weighings" ADD COLUMN     "parent_id" UUID;

-- CreateIndex
CREATE INDEX "idx_pre_weighings_parent_id" ON "pre_weighings"("parent_id");

-- AddForeignKey
ALTER TABLE "pre_weighings" ADD CONSTRAINT "pre_weighings_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "pre_weighings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
