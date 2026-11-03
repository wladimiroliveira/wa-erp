import { RecipesListPage } from "@/features/recipes/RecipesListPage";
import { listProducts } from "@/server/modules/products/products.repository";
import { listRecipes } from "@/server/modules/recipes/recipes.service";

// Both lists are whole: the filters narrow them on the client, so Consultar asks the server for nothing new.
export default async function Page() {
  const [products, summaries] = await Promise.all([listProducts(), listRecipes()]);

  return <RecipesListPage products={products} summaries={summaries} />;
}
