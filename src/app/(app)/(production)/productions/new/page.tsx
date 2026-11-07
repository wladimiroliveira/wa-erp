import { StartProductionPage } from "@/features/productions/StartProductionPage";
import { listPreWeighingsQuerySchema } from "@/server/modules/pre-weighings/pre-weighings.schemas";
import { listPreWeighingsPage } from "@/server/modules/pre-weighings/pre-weighings.service";
import { listProducts } from "@/server/modules/products/products.repository";

// Only a manufactured product has a recipe to plan from, and an inactive one is refused by the
// server. A pre-weighing is offered while no production uses it.
export default async function Page() {
  const [products, preWeighings] = await Promise.all([
    listProducts({ kind: ["MANUFACTURED"], status: "ACTIVE" }),
    listPreWeighingsPage(listPreWeighingsQuerySchema.parse({ available: "true" })),
  ]);

  return <StartProductionPage products={products} preWeighings={preWeighings} />;
}
