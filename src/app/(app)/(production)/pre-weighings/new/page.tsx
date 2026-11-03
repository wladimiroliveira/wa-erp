import { PreWeighingPage } from "@/features/pre-weighings/PreWeighingPage";
import { listProducts } from "@/server/modules/products/products.repository";

// Only a manufactured product has a recipe, and an inactive one is refused by the server.
export default async function Page() {
  const products = await listProducts({ kind: ["MANUFACTURED"], status: "ACTIVE" });

  return <PreWeighingPage products={products} />;
}
