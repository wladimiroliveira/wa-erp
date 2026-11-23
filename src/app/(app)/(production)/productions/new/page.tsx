import { StartProductionPage } from "@/features/productions/StartProductionPage";
import { listStartCandidates } from "@/server/modules/pre-weighings/pre-weighings.service";
import { listProducts } from "@/server/modules/products/products.repository";

// Only a manufactured product has a recipe to plan from, and an inactive one is refused by the
// server. A pre-weighing is offered while it is pending, with the pending stages under it.
export default async function Page() {
  const [products, candidates] = await Promise.all([
    listProducts({ kind: ["MANUFACTURED"], status: "ACTIVE" }),
    listStartCandidates(),
  ]);

  return <StartProductionPage products={products} candidates={candidates} />;
}
